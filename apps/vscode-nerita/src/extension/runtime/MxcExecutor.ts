// 承認済みコマンドを MXC に渡し、停止・タイムアウト・出力回収を同じプロセス寿命で管理する。
import { errorText } from "@nerita/shared/errorText";
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";
import { createProcessTreeStopper } from "./ProcessTreeStopper";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChildProcess } from "node:child_process";
import type { ContainerConfig } from "@microsoft/mxc-sdk";
import {
	consumeApprovedToolCall,
	toolCallFingerprint,
	type ApprovedToolCall,
	type ToolCall,
} from "../security/ApprovedToolCall";
import {
	containsPath,
	type AgentAccessPolicy,
} from "../security/AgentAccessPolicy";
import { evaluateTrust } from "../security/trust/TrustGate";
import type {
	SandboxCommandExecutor,
	SandboxCommandResult,
	SandboxCommandOutput,
} from "./SandboxCommandExecutor";
import type { MxcSdk } from "./MxcSdk";
import { spawnMxcLauncher } from "./MxcLauncher";
import { createMxcConfig, isVolumeRoot } from "./MxcPolicy";
import { discoverDevTools, toolResource } from "./DevToolDiscovery";
import { initialDevToolProfiles } from "./DevToolProfiles";
import { prepareDevToolStorage } from "./DevToolStorage";
import { readMxcDenials, type DenialReport } from "./MxcDenials";
import { MxcStderr } from "./MxcStderr";
import type { ResourcePolicy } from "@nerita/shared/sandboxPolicy";
import { randomUUID } from "node:crypto";
import type { SandboxManagement } from "./SandboxManagement";
import { workspaceFor } from "./ResourceGrantStore";
import {
	applyCredentialInjection,
	type CredentialInjection,
} from "../credentials/CredentialInjection";

/** SDK のロードと probe に成功した組み立て側だけが生成する。 */
export class MxcExecutor implements SandboxCommandExecutor {
	constructor(
		private readonly sdk: MxcSdk,
		private readonly isolationTier: string,
		private readonly onDenials?: (report: DenialReport) => void,
		private readonly onPolicy?: (resources: ResourcePolicy[]) => void,
		private readonly management?: SandboxManagement,
	) {}

	describe(policy: AgentAccessPolicy) {
		return {
			name: "Microsoft MXC",
			details: [
				this.isolationTier,
				`Network: ${policy.networkAccess ? "allow" : "deny"} / host loopback: ${policy.hostLoopbackAccess === true ? "allow" : "deny"}`,
				"Clipboard / input injection: deny",
			],
		};
	}

	async execute(
		approved: ApprovedToolCall,
		onOutput?: SandboxCommandOutput,
		injection?: CredentialInjection,
	): Promise<SandboxCommandResult> {
		const call = consumeApprovedToolCall(approved);
		await validateMxcCall(call);
		const trust = await evaluateTrust(call);
		approved.signal.throwIfAborted();
		const signal = trust
			? AbortSignal.any([approved.signal, trust])
			: approved.signal;
		const operationId = randomUUID();
		const fingerprint = approved.fingerprint;
		let stdout = "";
		let stderr = "";
		try {
			for (let attempt = 0; ; attempt++) {
				await validateMxcCall(call);
				await evaluateTrust(call);
				signal.throwIfAborted();
				if (toolCallFingerprint(call) !== fingerprint) {
					throw new Error("再実行の承認内容が一致しません。");
				}
				let report: DenialReport | undefined;
				const result = await executeMxcCommand(
					this.sdk,
					call,
					signal,
					onOutput,
					(value) => {
						report = value;
						this.onDenials?.(value);
						this.management?.denials(value);
					},
					this.onPolicy,
					injection,
					this.management,
					operationId,
				);
				stdout += result.stdout;
				stderr += result.stderr;
				if (
					!this.management ||
					!report ||
					result.exitCode === 0 ||
					attempt >= 3
				) {
					return { ...result, stdout, stderr };
				}
				if (
					!(await this.management.waitForDecision(
						report,
						call,
						operationId,
						signal,
						() =>
							onOutput?.(
								"stderr",
								"\nSandbox の拒否を確認しました。Sandbox 管理画面で許可・キャッシュ切替・拒否を選択してください。\n",
							),
					))
				) {
					signal.throwIfAborted();
					return { ...result, stdout, stderr };
				}
			}
		} finally {
			await this.management?.resourceGrants.finish(operationId);
		}
	}
}

/** 起動 probe は固定コマンド専用。モデルからの入力は必ず executor の承認境界を通す。 */
export async function executeMxcCommand(
	sdk: MxcSdk,
	call: ToolCall,
	signal: AbortSignal,
	onOutput?: SandboxCommandOutput,
	onDenials?: (report: DenialReport) => void,
	onPolicy?: (resources: ResourcePolicy[]) => void,
	injection?: CredentialInjection,
	management?: SandboxManagement,
	operationId = randomUUID(),
): Promise<SandboxCommandResult> {
	signal.throwIfAborted();
	if (!isNonEmptyString(process.env.SystemRoot)) {
		throw new Error("Windows の SystemRoot を取得できません。");
	}
	const hostTemporary = await mkdtemp(join(tmpdir(), "nerita-mxc-"));
	const temporary = join(hostTemporary, "sandbox");
	try {
		await mkdir(temporary);
		let devTools = await prepareMxcDevTools(call, temporary, management);
		if (management) {
			devTools = await management.resourceGrants.apply(
				devTools,
				call,
				operationId,
			);
		}
		const config = createMxcConfig(sdk, call, temporary, devTools);
		applyCredentialInjection(config, injection);
		signal = AbortSignal.any([
			signal,
			...(injection ? [injection.signal] : []),
		]);
		onPolicy?.(structuredClone(devTools.resources));
		management?.policy(devTools.resources);
		assertPrivateReport(config, hostTemporary);
		config.processContainer = {
			...config.processContainer,
			captureDenials: {
				mode: "block",
				outputPath: join(hostTemporary, "denials.json"),
				retainEtl: false,
			},
		};
		signal.throwIfAborted();
		const result = await collectOutput(
			spawnMxcLauncher(sdk, config, call.cwd),
			signal,
			call.timeoutMs!,
			hostTemporary,
			onOutput,
		);
		// MXC 本体が先にタイムアウトすると、起動用プロセスは終了コードと構造化エラーを返す。
		// Host 側のタイマーより先に `close` イベントが届いても、正常終了として扱わない。
		const timeoutError = JSON.stringify({
			error: {
				code: "backend_error",
				message: `script timed out after ${call.timeoutMs}ms`,
			},
		});
		if (
			result.exitCode === 0xffff_ffff &&
			result.stderr.trimEnd().endsWith(timeoutError)
		) {
			throw new Error("Sandbox 実行がタイムアウトしました。");
		}
		const report = await readMxcDenials(hostTemporary, devTools);
		onDenials?.(report);
		return result;
	} finally {
		// mkdtemp が返した専用領域だけを回収する。リンクの置換は辿らない。
		await rm(hostTemporary, { recursive: true, force: true });
	}
}

/** ワークスペースが一時領域の祖先だった場合も、子からレポートを改変できる構成を起動しない。 */
function assertPrivateReport(config: ContainerConfig, directory: string): void {
	const roots = [
		...(config.filesystem?.readonlyPaths ?? []).filter(
			(root) => !isVolumeRoot(root),
		),
		...(config.filesystem?.readwritePaths ?? []),
	];
	if (roots.some((root) => containsPath(root, directory))) {
		throw new Error(
			"拒否レポートを Sandbox の公開範囲から分離できません。",
		);
	}
}

/** 引数と cwd の実体を実行直前に確認し、子 role の書込み上限を拡大しない。 */
async function validateMxcCall(call: ToolCall) {
	validateCommand(call);
	await validateRoots(call);
}

/** SDK へ渡す前に、承認済みの引数と実行時間が許容範囲内か確認する。 */
function validateCommand(call: ToolCall) {
	if (
		!call.policy.shell ||
		!isNonZeroNumber(call.command?.length) ||
		!isNonEmptyString(call.command[0]) ||
		call.command.some((arg) => arg.includes("\0")) ||
		!Number.isSafeInteger(call.timeoutMs) ||
		call.timeoutMs! < 1 ||
		call.timeoutMs! > 600_000
	) {
		throw new Error("未対応のSandbox要求です。");
	}
}

/** パス変更や role の権限拡大は再承認でも暗黙に許可しない。 */
async function validateRoots(call: ToolCall) {
	if (
		!call.policy.workspaceRoots.some((root) =>
			containsPath(root, call.cwd),
		) ||
		call.policy.writableRoots.some(
			(root) =>
				!call.policy.workspaceRoots.some((workspace) =>
					containsPath(workspace, root),
				),
		)
	) {
		throw new Error("Sandbox の workspace 境界外です。");
	}
	for (const path of [
		...call.policy.workspaceRoots,
		...call.policy.writableRoots,
		call.cwd,
	]) {
		if ((await realpath(path)) !== path) {
			throw new Error("パスが変更されました。再承認が必要です。");
		}
	}
}

/** 子孫も終了させ、close まで待ってから専用 temp を削除する。 */
function collectOutput(
	child: ChildProcess,
	signal: AbortSignal,
	timeoutMs: number,
	reportDirectory: string,
	onOutput?: SandboxCommandOutput,
): Promise<SandboxCommandResult> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let failure: Error | undefined;
		const stop = createProcessTreeStopper(child);
		const abort = () => {
			failure = new Error("Sandbox 実行を停止しました。", {
				cause: signal.reason,
			});
			stop();
		};
		const timer = setTimeout(() => {
			failure = new Error("Sandbox 実行がタイムアウトしました。");
			stop();
		}, timeoutMs + 1000);
		const notify = (stream: "stdout" | "stderr", chunk: string) => {
			try {
				onOutput?.(stream, chunk);
			} catch (error) {
				failure =
					error instanceof Error
						? error
						: new Error(errorText(error));
				stop();
			}
		};
		child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
			notify("stdout", chunk);
		});
		const stderrFilter = new MxcStderr(reportDirectory, (chunk) => {
			stderr += chunk;
			notify("stderr", chunk);
		});
		child.stderr
			?.setEncoding("utf8")
			.on("data", (chunk: string) => stderrFilter.write(chunk));
		child.once("error", (error) => {
			failure = error;
		});
		child.once("close", (exitCode) => {
			stderrFilter.end();
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (failure) {
				reject(failure);
			} else if (exitCode === null) {
				reject(new Error("MXC プロセスの終了コードを取得できません。"));
			} else {
				resolve({ stdout, stderr, exitCode });
			}
		});
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
		}
	});
}
/** 通常の開発ツール設定を秘密値の注入より先に用意する。 */
async function prepareMxcDevTools(
	call: ToolCall,
	temporary: string,
	management?: SandboxManagement,
) {
	const discovered = await discoverDevTools(
		call.env ?? {},
		initialDevToolProfiles,
		call.command?.[0],
	);
	const managedRoot = process.env.LOCALAPPDATA;
	if (!isNonEmptyString(managedRoot)) {
		throw new Error("Sandbox キャッシュの保存先を取得できません。");
	}
	// 拒否されたホストキャッシュを分類する候補。検出しても読み書きは許可しない。
	for (const [tool, target] of [
		["pnpm", join(managedRoot, "pnpm", "store")],
		["pnpm", join(managedRoot, "pnpm-cache")],
		["node", join(managedRoot, "npm-cache")],
	] as const) {
		discovered.resources.push(
			toolResource("cache", target, tool, "profile"),
		);
	}
	return prepareDevToolStorage(
		discovered,
		join(managedRoot, "Nerita", "sandbox-cache"),
		workspaceFor(call),
		temporary,
		isNonEmptyString(process.env.USERPROFILE)
			? join(process.env.USERPROFILE, ".npmrc")
			: undefined,
		management ? management.resourceGrants.usesCache(call) : true,
	);
}
