// 既知の互換性問題に対して明示承認された argv だけを Host で実行する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import { createProcessTreeStopper } from "./ProcessTreeStopper";
import { spawn, type ChildProcess } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
	consumeApprovedToolCall,
	type ApprovedToolCall,
	type ToolCall,
} from "../security/ApprovedToolCall";
import { evaluateTrust } from "../security/trust/TrustGate";
import { containsPath } from "../security/AgentAccessPolicy";
import { classifyToolCommand } from "./LogicalToolCommand";
import type { CredentialInjection } from "../credentials/CredentialInjection";
import type {
	SandboxCommandExecutor,
	SandboxCommandOutput,
	SandboxCommandResult,
} from "./SandboxCommandExecutor";

/** 通常の Sandbox 失敗からは呼ばない。承認対象に Host 経路と互換性診断が必要。 */
export class HostToolExecutor implements SandboxCommandExecutor {
	/** 承認済み内容・実体パス・信頼を再確認し、取消しと注入の失効を子プロセスへ伝えて実行する。 */
	async execute(
		approved: ApprovedToolCall,
		output?: SandboxCommandOutput,
		injection?: CredentialInjection,
	): Promise<SandboxCommandResult> {
		const call = consumeApprovedToolCall(approved);
		validateHostCall(call);
		for (const path of [call.cwd, call.command![0]!]) {
			const matchesValue = (await realpath(path)) !== path;
			if (matchesValue) {
				throw new Error("実行パスが変更されました。再承認が必要です。");
			}
		}
		const trust = await evaluateTrust(call);
		const trustedSignal = trust
			? AbortSignal.any([approved.signal, trust])
			: approved.signal;
		const signal = injection
			? AbortSignal.any([trustedSignal, injection.signal])
			: trustedSignal;
		signal.throwIfAborted();
		const env = Object.fromEntries(
			Object.entries(call.env ?? {}).filter(
				(entry): entry is [string, string] => entry[1] !== null,
			),
		);
		const child = spawn(call.command![0]!, call.command!.slice(1), {
			cwd: call.cwd,
			env: { ...env, ...injection?.env },
			shell: false,
			windowsHide: true,
			stdio: "pipe",
		});
		return collectHostOutput(child, signal, call.timeoutMs!, output);
	}
}

/** 保存済み権限だけで起動せず、1回限りの実行許可を消費した要求の分類と承認キーを照合する。 */
function validateHostCall(call: ToolCall) {
	const permission = call.compatibility?.permission;

	if (!(call.hostShell === true)) {
		throw new Error("明示承認された Host 実行要求ではありません。");
	}
	if (!call.policy.shell) {
		throw new Error("明示承認された Host 実行要求ではありません。");
	}
	if (!isNonZeroNumber(call.command?.length)) {
		throw new Error("明示承認された Host 実行要求ではありません。");
	}
	if (!permission || call.compatibility?.code !== "native-pnpm-dos-path") {
		throw new Error("明示承認された Host 実行要求ではありません。");
	}
	validateHostIdentity(call);
	validateHostLimits(call);
}

/** 引数の分類と承認キーを照合し、モデルが置ける起動ファイルを拒否する。 */
function validateHostIdentity(call: ToolCall) {
	const permission = call.compatibility!.permission;
	const command = call.command!;
	const matchesRoute =
		permission.route !== "host" ||
		permission.tool !== "pnpm" ||
		basename(command[0]!).toLowerCase() !== "pnpm.exe";
	if (matchesRoute) {
		throw new Error("Host 実行の承認キーと起動対象が一致しません。");
	}
	const matchesClassifyToolCommand =
		classifyToolCommand("pnpm", command.slice(1)) !==
			permission.commandClass ||
		!call.policy.workspaceRoots.includes(permission.workspace) ||
		!containsPath(permission.workspace, call.cwd);
	if (matchesClassifyToolCommand) {
		throw new Error("Host 実行の承認キーと起動対象が一致しません。");
	}
	const matchesSome = call.policy.workspaceRoots.some((root) =>
		containsPath(root, command[0]!),
	);
	if (matchesSome) {
		throw new Error("Host 実行の承認キーと起動対象が一致しません。");
	}
}

/** Host では role の隔離を再現できないため、制限された role を暗黙に解除しない。 */
function validateHostLimits(call: ToolCall) {
	if (!Number.isSafeInteger(call.timeoutMs)) {
		throw new Error("Host 実行の引数または時間制限が不正です。");
	}
	if (call.timeoutMs! < 1) {
		throw new Error("Host 実行の引数または時間制限が不正です。");
	}
	if (call.timeoutMs! > 600_000) {
		throw new Error("Host 実行の引数または時間制限が不正です。");
	}
	if (call.command!.some((arg) => arg.includes("\0"))) {
		throw new Error("Host 実行の引数または時間制限が不正です。");
	}
	// Host では readOnly role を隔離できないため、子の書込み上限を解除して起動しない。
	const matchesSome = call.policy.workspaceRoots.some(
		(root) => !call.policy.writableRoots.includes(root),
	);
	if (matchesSome) {
		throw new Error(
			"書き込み範囲を制限した役割では、Host での実行を利用できません。",
		);
	}
}

/** 停止時は子孫も終了し、close まで実行結果を確定しない。 */
function collectHostOutput(
	child: ChildProcess,
	signal: AbortSignal,
	timeout: number,
	output?: SandboxCommandOutput,
): Promise<SandboxCommandResult> {
	/** 出力・期限・停止を追跡し、close で終了を確認してから結果を返す。通知失敗も実行を停止させる。 */
	const waitForHostOutput = (
		resolve: (value: SandboxCommandResult) => void,
		reject: (reason: unknown) => void,
	) => {
		let stdout = "";
		let stderr = "";
		let failure: Error | undefined;
		const stop = createProcessTreeStopper(child);
		/** 中断理由を実行失敗へ保持してから、Host で起動したプロセスを停止する。 */
		const abort = () => {
			failure = new Error("Host 実行を停止しました。", {
				cause: signal.reason,
			});
			stop();
		};
		const timer = setTimeout(() => {
			failure = new Error("Host 実行がタイムアウトしました。");
			stop();
		}, timeout);
		/** Host 実行の途中出力を通知し、通知先の失敗時には実行を停止する。 */
		const notify = (stream: "stdout" | "stderr", text: string) => {
			try {
				output?.(stream, text);
			} catch (error) {
				failure = new Error("途中出力の通知に失敗しました。", {
					cause: error,
				});
				stop();
			}
		};
		child.stdout?.setEncoding("utf8").on("data", (text: string) => {
			stdout += text;
			notify("stdout", text);
		});
		child.stderr?.setEncoding("utf8").on("data", (text: string) => {
			stderr += text;
			notify("stderr", text);
		});
		child.once("error", (error) => {
			failure = error;
		});
		child.once("close", (exitCode) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (failure) {
				reject(failure);
			} else if (exitCode === null) {
				reject(
					new Error("Host プロセスの終了コードを取得できません。"),
				);
			} else {
				resolve({ stdout, stderr, exitCode });
			}
		});
		child.stdin?.end();
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
		}
	};
	return new Promise(waitForHostOutput);
}
