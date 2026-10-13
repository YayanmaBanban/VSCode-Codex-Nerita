// 承認済みコマンドを MXC に渡し、停止・タイムアウト・出力回収を同じプロセス寿命で管理する。
import { errorText } from "@nerita/shared/errorText";
import { performance } from "node:perf_hooks";
import { MxcTiming, type MxcMeasurement } from "./MxcTiming";
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
	/** SDK と隔離方式を実行経路に固定し、拒否・実測・権限の通知は注入した受信先へ渡す。 */
	constructor(
		private readonly sdk: MxcSdk,
		private readonly isolationTier: string,
		private readonly onDenials?: (report: DenialReport) => void,
		private readonly onPolicy?: (resources: ResourcePolicy[]) => void,
		private readonly management?: SandboxManagement,
		private readonly onMeasurement?: (value: MxcMeasurement) => void,
	) {}

	/** 実行器の隔離方式とネットワーク上限を示し、クリップボードと入力注入は許可しない。 */
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

	/** 実行と再試行のたびに承認内容・ルート・信頼を照合し、拒否の対応は管理画面の決定を待ってから反映する。 */
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
					this.onMeasurement,
				);
				stdout += result.stdout;
				stderr += result.stderr;
				if (!this.management || !report || result.exitCode === 0) {
					return { ...result, stdout, stderr };
				}
				if (attempt >= 3) {
					return { ...result, stdout, stderr };
				}
				const matchesValue = !(await this.management.waitForDecision(
					report,
					call,
					operationId,
					signal,
					() =>
						onOutput?.(
							"stderr",
							"\nSandbox の拒否を確認しました。Sandbox 管理画面で許可・キャッシュ切替・拒否を選択してください。\n",
						),
				));
				if (matchesValue) {
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
	onMeasurement?: (value: MxcMeasurement) => void,
): Promise<SandboxCommandResult> {
	signal.throwIfAborted();
	if (!isNonEmptyString(process.env.SystemRoot)) {
		throw new Error(
			"Windows のシステムルートを環境変数から取得できません。",
		);
	}
	const timing = new MxcTiming();
	const hostTemporary = await timing.measure("temporaryMs", () =>
		mkdtemp(join(tmpdir(), "nerita-mxc-")),
	);
	const temporary = join(hostTemporary, "sandbox");
	try {
		await timing.measure("temporaryMs", () => mkdir(temporary));
		let devTools = await prepareMxcDevTools(
			call,
			temporary,
			timing,
			management,
		);
		const policyStarted = performance.now();
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
		timing.value.policyMs = performance.now() - policyStarted;
		const result = await measuredMxcOutput(
			sdk,
			config,
			call,
			signal,
			hostTemporary,
			timing,
			onOutput,
		);
		assertMxcCompleted(result, call.timeoutMs!);
		const report = await timing.measure("denialsMs", () =>
			readMxcDenials(hostTemporary, devTools),
		);
		onDenials?.(report);
		return result;
	} finally {
		await cleanupMxc(hostTemporary, timing, onMeasurement);
	}
}

/** MXC の専用一時領域を回収し、回収の成功・失敗にかかわらず計測を完了する。 */
async function cleanupMxc(
	hostTemporary: string,
	timing: MxcTiming,
	onMeasurement?: (value: MxcMeasurement) => void,
): Promise<void> {
	// mkdtemp が返した専用領域だけを回収する。リンクの置換は辿らない。
	try {
		await timing.measure("cleanupMs", () =>
			rm(hostTemporary, { recursive: true, force: true }),
		);
	} finally {
		timing.finish(onMeasurement);
	}
}

/** MXC の起動・初回出力・終了までを計測し、途中出力を利用側へ通知する。 */
async function measuredMxcOutput(
	sdk: MxcSdk,
	config: ContainerConfig,
	call: ToolCall,
	signal: AbortSignal,
	reportDirectory: string,
	timing: MxcTiming,
	onOutput?: SandboxCommandOutput,
): Promise<SandboxCommandResult> {
	const launchStarted = performance.now();
	const child = spawnMxcLauncher(sdk, config, call.cwd);
	timing.value.spawnMs = performance.now() - launchStarted;
	/** 初回出力までの時間を一度だけ記録し、元のストリーム種別で出力を通知する。 */
	const output = (stream: "stdout" | "stderr", chunk: string) => {
		timing.value.firstOutputMs ??= performance.now() - launchStarted;
		onOutput?.(stream, chunk);
	};
	return timing.measure("executionMs", () =>
		collectOutput(child, signal, call.timeoutMs!, reportDirectory, output),
	);
}

/** MXC が自身の期限で停止した終了結果を識別し、Host 側のタイマーより早い終了も失敗として扱う。 */
function assertMxcCompleted(
	result: SandboxCommandResult,
	timeoutMs: number,
): void {
	// MXC 本体が先にタイムアウトすると、起動用プロセスは終了コードと構造化エラーを返す。
	// Host 側のタイマーより先に `close` イベントが届いても、正常終了として扱わない。
	const timeoutError = JSON.stringify({
		error: {
			code: "backend_error",
			message: `script timed out after ${timeoutMs}ms`,
		},
	});
	const matchesExitCode =
		result.exitCode === 0xffff_ffff &&
		result.stderr.trimEnd().endsWith(timeoutError);
	if (matchesExitCode) {
		throw new Error("Sandbox 実行がタイムアウトしました。");
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
	if (!call.policy.shell) {
		throw new Error("未対応のSandbox要求です。");
	}
	if (!isNonZeroNumber(call.command?.length)) {
		throw new Error("未対応のSandbox要求です。");
	}
	if (!isNonEmptyString(call.command[0])) {
		throw new Error("未対応のSandbox要求です。");
	}

	if (call.command.some((arg) => arg.includes("\0"))) {
		throw new Error("未対応のSandbox要求です。");
	}
	if (!Number.isSafeInteger(call.timeoutMs)) {
		throw new Error("未対応のSandbox要求です。");
	}
	if (call.timeoutMs! < 1) {
		throw new Error("未対応のSandbox要求です。");
	}
	if (call.timeoutMs! > 600_000) {
		throw new Error("未対応のSandbox要求です。");
	}
}

/** パス変更や role の権限拡大は再承認でも暗黙に許可しない。 */
async function validateRoots(call: ToolCall) {
	const workspaceContainsCwd = call.policy.workspaceRoots.some((root) =>
		containsPath(root, call.cwd),
	);
	if (!workspaceContainsCwd) {
		throw new Error("Sandbox のワークスペースの範囲外です。");
	}
	const invalidWritableRoot = call.policy.writableRoots.some(
		(root) =>
			!call.policy.workspaceRoots.some((workspace) =>
				containsPath(workspace, root),
			),
	);
	if (invalidWritableRoot) {
		throw new Error("Sandbox のワークスペースの範囲外です。");
	}
	for (const path of [
		...call.policy.workspaceRoots,
		...call.policy.writableRoots,
		call.cwd,
	]) {
		const matchesValue2 = (await realpath(path)) !== path;
		if (matchesValue2) {
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
	/** 出力・期限・停止を追跡し、管理用の stderr 参照を除いて終了確認後の結果を返す。 */
	const waitForMxcOutput: SandboxResultWaiter = (resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let failure: Error | undefined;
		const stop = createProcessTreeStopper(child);
		/** 中断理由を実行失敗へ保持してから、MXC の起動プロセスを停止する。 */
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
		/** 途中出力を通知し、通知先の失敗も保持して MXC の実行を停止する。 */
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
	};
	return new Promise(waitForMxcOutput);
}
/** 通常の開発ツール設定を秘密値の注入より先に用意する。 */
async function prepareMxcDevTools(
	call: ToolCall,
	temporary: string,
	timing: MxcTiming,
	management?: SandboxManagement,
) {
	const discovered = await timing.measure("discoveryMs", () =>
		discoverDevTools(
			call.env ?? {},
			initialDevToolProfiles,
			call.command?.[0],
		),
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
	return timing.measure("storageMs", () =>
		prepareDevToolStorage(
			discovered,
			join(managedRoot, "Nerita", "sandbox-cache"),
			workspaceFor(call),
			temporary,
			isNonEmptyString(process.env.USERPROFILE)
				? join(process.env.USERPROFILE, ".npmrc")
				: undefined,
			management ? management.resourceGrants.usesCache(call) : true,
		),
	);
}

/** Promise の完了と拒否を受け取り、終了確認まで結果を待つ処理。 */
type SandboxResultWaiter = (
	resolve: (value: SandboxCommandResult) => void,
	reject: (reason: unknown) => void,
) => void;
