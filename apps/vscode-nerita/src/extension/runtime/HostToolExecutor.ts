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
	async execute(
		approved: ApprovedToolCall,
		output?: SandboxCommandOutput,
		injection?: CredentialInjection,
	): Promise<SandboxCommandResult> {
		const call = consumeApprovedToolCall(approved);
		validateHostCall(call);
		for (const path of [call.cwd, call.command![0]!]) {
			if ((await realpath(path)) !== path) {
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
	if (
		!(call.hostShell === true) ||
		!call.policy.shell ||
		!isNonZeroNumber(call.command?.length) ||
		!permission ||
		call.compatibility?.code !== "native-pnpm-dos-path"
	) {
		throw new Error("明示承認された Host 実行要求ではありません。");
	}
	validateHostIdentity(call);
	validateHostLimits(call);
}

/** 引数の分類と承認キーを照合し、モデルが置ける起動ファイルを拒否する。 */
function validateHostIdentity(call: ToolCall) {
	const permission = call.compatibility!.permission;
	const command = call.command!;
	if (
		permission.route !== "host" ||
		permission.tool !== "pnpm" ||
		basename(command[0]!).toLowerCase() !== "pnpm.exe" ||
		classifyToolCommand("pnpm", command.slice(1)) !==
			permission.commandClass ||
		!call.policy.workspaceRoots.includes(permission.workspace) ||
		!containsPath(permission.workspace, call.cwd) ||
		call.policy.workspaceRoots.some((root) =>
			containsPath(root, command[0]!),
		)
	) {
		throw new Error("Host 実行の承認キーと起動対象が一致しません。");
	}
}

/** Host では role の隔離を再現できないため、制限された role を暗黙に解除しない。 */
function validateHostLimits(call: ToolCall) {
	if (
		!Number.isSafeInteger(call.timeoutMs) ||
		call.timeoutMs! < 1 ||
		call.timeoutMs! > 600_000 ||
		call.command!.some((arg) => arg.includes("\0"))
	) {
		throw new Error("Host 実行の引数または時間制限が不正です。");
	}
	// Host では readOnly role を隔離できないため、子の書込み上限を解除して起動しない。
	if (
		call.policy.workspaceRoots.some(
			(root) => !call.policy.writableRoots.includes(root),
		)
	) {
		throw new Error(
			"書込み範囲を制限した role では Host 実行を利用できません。",
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
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let failure: Error | undefined;
		const stop = createProcessTreeStopper(child);
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
	});
}
