// 承認済みコマンドを MXC に渡し、停止・タイムアウト・出力回収を同じプロセス寿命で管理する。
import { errorText } from "@nerita/shared/errorText";
import { performance } from "node:perf_hooks";
import { MxcTiming, type MxcMeasurement } from "./MxcTiming";
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";
import { finished } from "node:stream/promises";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContainerRequest, MxcProcess } from "@microsoft/mxc-sdk/v1";
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
import { createMxcRequest, isVolumeRoot } from "./MxcPolicy";
import { discoverDevTools, toolResource } from "./DevToolDiscovery";
import { initialDevToolProfiles } from "./DevToolProfiles";
import { prepareDevToolStorage } from "./DevToolStorage";
import { readMxcDenials, type DenialReport } from "./MxcDenials";
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
		const config = createMxcRequest(call, temporary, devTools);
		applyCredentialInjection(config, injection);
		signal = AbortSignal.any([
			signal,
			...(injection ? [injection.signal] : []),
		]);
		onPolicy?.(structuredClone(devTools.resources));
		management?.policy(devTools.resources);
		assertPrivateReport(config, hostTemporary);
		config.containment.config = {
			...config.containment.config,
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
			timing,
			onOutput,
		);
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

/** ワークスペースが一時領域の祖先だった場合も、子からレポートを改変できる構成を起動しない。 */
function assertPrivateReport(
	config: ContainerRequest,
	directory: string,
): void {
	const roots = [
		...(config.filesystem?.readonlyPaths ?? []).filter(
			(root) => !isVolumeRoot(root),
		),
		...(config.filesystem?.readwritePaths ?? []),
	];
	if (roots.some((root) => containsPath(root, directory))) {
		throw new Error(
			"拒否レポートの保存先が、サンドボックスからアクセスできる範囲内にあります。",
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

/** V1 のネイティブプロセスを起動し、初回出力と終了までを計測する。 */
async function measuredMxcOutput(
	sdk: MxcSdk,
	config: ContainerRequest,
	call: ToolCall,
	signal: AbortSignal,
	timing: MxcTiming,
	onOutput?: SandboxCommandOutput,
): Promise<SandboxCommandResult> {
	const launchStarted = performance.now();
	// 設定と資格情報は FFI に直接渡す。コマンドラインや設定ファイルへ直列化しない。
	const child = await sdk.spawn(config);
	timing.value.spawnMs = performance.now() - launchStarted;
	/** 初回出力だけを計測し、呼出し側へ元のストリーム種別で通知する。 */
	const output: SandboxCommandOutput = (stream, chunk) => {
		timing.value.firstOutputMs ??= performance.now() - launchStarted;
		onOutput?.(stream, chunk);
	};
	try {
		return await timing.measure("executionMs", () =>
			collectOutput(child, signal, call.timeoutMs!, output),
		);
	} finally {
		child.dispose();
	}
}

/** SDK でコンテナ全体を停止し、終了とパイプの EOF を待ってから temp を回収する。 */
async function collectOutput(
	child: MxcProcess,
	signal: AbortSignal,
	timeoutMs: number,
	onOutput: SandboxCommandOutput,
): Promise<SandboxCommandResult> {
	let stdout = "";
	let stderr = "";
	let failure: Error | undefined;
	/** 最初の失敗理由を保持し、SDK のコンテナ停止を要求する。 */
	const stop = (error: Error) => {
		failure ??= error;
		child.kill();
	};
	/** 信頼や資格情報の取消しも、同じ停止経路で扱う。 */
	const abort = () =>
		stop(
			new Error("Sandbox 実行を停止しました。", { cause: signal.reason }),
		);
	const timer = setTimeout(
		() => stop(new Error("Sandbox 実行がタイムアウトしました。")),
		timeoutMs + 1000,
	);
	const drains = [];
	for (const [stream, pipe] of [
		["stdout", child.standardOutput],
		["stderr", child.standardError],
	] as const) {
		if (!pipe) {continue;}
		pipe.setEncoding("utf8").on("data", (chunk: string) => {
			if (stream === "stdout") {stdout += chunk;}
			else {stderr += chunk;}
			try {
				onOutput(stream, chunk);
			} catch (error) {
				stop(
					error instanceof Error
						? error
						: new Error(errorText(error)),
				);
			}
		});
		drains.push(finished(pipe, { cleanup: true }));
	}
	signal.addEventListener("abort", abort, { once: true });
	try {
		if (signal.aborted) {abort();}
		const [result] = await Promise.all([child.wait(), ...drains]);
		if (failure) {throw failure;}
		if (result.timedOut)
			{throw new Error("Sandbox 実行がタイムアウトしました。");}
		const captureError = child.outputMetadata?.captureDenialsError;
		if (captureError) {throw new Error(captureError.message);}
		// 警告は SDK の構造化された値から取得し、ツールの stderr を解析しない。
		for (const warning of child.warnings) {
			const text = `[MXC] ${warning}\n`;
			stderr += text;
			onOutput("stderr", text);
		}
		return { stdout, stderr, exitCode: result.exitCode };
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
	}
}
