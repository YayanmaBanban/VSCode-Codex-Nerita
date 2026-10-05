// 承認済みコマンドを MXC に渡し、停止・タイムアウト・出力回収を同じプロセス寿命で管理する。
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, type ChildProcess } from "node:child_process";
import type { ContainerConfig } from "@microsoft/mxc-sdk";
import {
	consumeApprovedToolCall,
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
import { createMxcConfig, isVolumeRoot } from "./MxcPolicy";
import { discoverDevTools } from "./DevToolDiscovery";
import { initialDevToolProfiles } from "./DevToolProfiles";
import { prepareDevToolStorage } from "./DevToolStorage";
import { readMxcDenials, type DenialReport } from "./MxcDenials";
import { MxcStderr } from "./MxcStderr";
import type { ResourcePolicy } from "@nerita/shared/sandboxPolicy";

/** SDK のロードと probe に成功した組み立て側だけが生成する。 */
export class MxcExecutor implements SandboxCommandExecutor {
	constructor(
		private readonly sdk: MxcSdk,
		private readonly isolationTier: string,
		private readonly onDenials?: (report: DenialReport) => void,
		private readonly onPolicy?: (resources: ResourcePolicy[]) => void,
	) {}

	describe(policy: AgentAccessPolicy) {
		return {
			name: "Microsoft MXC",
			details: [
				this.isolationTier,
				`Network: ${policy.networkAccess ? "allow" : "deny"} / host loopback: deny`,
				"Clipboard / input injection: deny",
			],
		};
	}

	async execute(
		approved: ApprovedToolCall,
		onOutput?: SandboxCommandOutput,
	): Promise<SandboxCommandResult> {
		const call = consumeApprovedToolCall(approved);
		await validateMxcCall(call);
		const trust = await evaluateTrust(call);
		approved.signal.throwIfAborted();
		const signal = trust
			? AbortSignal.any([approved.signal, trust])
			: approved.signal;
		return executeMxcCommand(
			this.sdk,
			call,
			signal,
			onOutput,
			this.onDenials,
			this.onPolicy,
		);
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
): Promise<SandboxCommandResult> {
	signal.throwIfAborted();
	if (!process.env.SystemRoot) {
		throw new Error("Windows の SystemRoot を取得できません。");
	}
	const hostTemporary = await mkdtemp(join(tmpdir(), "nerita-mxc-"));
	const temporary = join(hostTemporary, "sandbox");
	try {
		await mkdir(temporary);
		const discovered = await discoverDevTools(
			call.env ?? {},
			initialDevToolProfiles,
			call.command?.[0],
		);
		const managedRoot = process.env.LOCALAPPDATA;
		if (!managedRoot) {
			throw new Error("Sandbox キャッシュの保存先を取得できません。");
		}
		const devTools = await prepareDevToolStorage(
			discovered,
			join(managedRoot, "Nerita", "sandbox-cache"),
			call.policy.workspaceRoots[0]!,
			temporary,
			process.env.USERPROFILE
				? join(process.env.USERPROFILE, ".npmrc")
				: undefined,
		);
		const config = createMxcConfig(sdk, call, temporary, devTools);
		onPolicy?.(structuredClone(devTools.resources));
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
		const child = sdk.spawnSandboxFromConfig(
			config,
			{ usePty: false },
			call.cwd,
		);
		const result = await collectOutput(
			child,
			signal,
			call.timeoutMs!,
			hostTemporary,
			onOutput,
		);
		const report = await readMxcDenials(hostTemporary, devTools);
		onDenials?.(report);
		return result;
	} finally {
		// mkdtemp が返した専用領域だけを回収する。リンクの置換は辿らない。
		await rm(hostTemporary, { recursive: true, force: true });
	}
}

/** workspace が temp の祖先だった場合も、子からレポートを改変できる構成を起動しない。 */
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

/** SDK に渡す前に承認済み argv と実行時間の範囲を確認する。 */
function validateCommand(call: ToolCall) {
	if (
		!call.policy.shell ||
		!call.command?.length ||
		!call.command[0] ||
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
		let stopping = false;
		const stop = () => {
			if (stopping || !child.pid) {
				return;
			}
			stopping = true;
			execFile(
				join(process.env.SystemRoot!, "System32", "taskkill.exe"),
				["/PID", String(child.pid), "/T", "/F"],
				{ windowsHide: true, timeout: 5000 },
				() => {
					if (child.exitCode === null && child.signalCode === null) {
						child.kill();
					}
				},
			);
		};
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
					error instanceof Error ? error : new Error(String(error));
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
		child.stdin?.end();
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
		}
	});
}
