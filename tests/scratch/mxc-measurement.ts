// 本番の Pi ツール・承認キューと MXC 本体を使用する。モデル通信と VS Code の描画時間は測定対象に含めない。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	copyFile,
	mkdir,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { release, cpus, totalmem } from "node:os";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { loadPiSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSdk";
import { PiPermissions } from "../../apps/vscode-nerita/src/extension/backends/pi/PiPermissions";
import type { ToolAuthorizer } from "../../apps/vscode-nerita/src/extension/security/ApprovalGuard";
import { createPiSandboxPowerShellTool } from "../../apps/vscode-nerita/src/extension/backends/pi/PiPowerShellTool";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import type { MxcMeasurement } from "../../apps/vscode-nerita/src/extension/runtime/MxcTiming";
import { SandboxManagement } from "../../apps/vscode-nerita/src/extension/runtime/SandboxManagement";
import { resolvePowerShell } from "../../apps/vscode-nerita/src/extension/runtime/PowerShellExecutable";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { WorkspacePathPolicy } from "../../apps/vscode-nerita/src/extension/security/WorkspacePathPolicy";
import { WorktreeManager } from "../../apps/vscode-nerita/src/extension/dlc/WorktreeManager";
import {
	instrumentLauncher,
	parseProbe,
	summarize,
	type Sample,
} from "./mxc-measurement-support";

type Context = Awaited<ReturnType<typeof context>>;
const repetitions = 5;
const approvalDelayMs = 200;

/** SDK は同梱と同じ形でロードし、ウォームアップも結果に残す。 */
export async function measure(
	root: string,
	extension: string,
	baseline?: string,
) {
	const ctx = await context(root, extension, baseline);
	const samples: Sample[] = [];
	for (let trial = 1; trial <= repetitions; trial++) {
		// キャッシュ設定と時間経過が一致しないよう、組ごとに順番を入れ替える。
		for (const persistent of trial % 2 === 1
			? [false, true]
			: [true, false]) {
			samples.push(...(await runVariants(ctx, persistent, trial)));
		}
	}
	ctx.session.dispose();
	return {
		environment: {
			platform: process.platform,
			architecture: process.arch,
			windows: release(),
			node: process.versions.node,
			cpu: cpus()[0]?.model,
			logicalCpus: cpus().length,
			memoryGiB: totalmem() / 1024 ** 3,
			mxcVersion: ctx.version,
			repetitions,
			order: `5組でキャッシュ無/有と変更前/後の実行順を交互に入れ替える。全${samples.length}回を保持し、集計は各ランチャーのfirst/repeat/parallelの40回を用いる。`,
			approvalDelayMs,
			command:
				"Windows PowerShell → Node: 64 KiB の固定キャッシュを読み書きし、SHA-256 を検証する。ネットワークは使用しない。",
			first: "新しい Worktree・キャッシュでの初回実行。OS のファイルキャッシュを消去した状態での計測ではない。",
			parallel:
				"A/B をそれぞれ一度実行してから、Git で作成した2つの Worktree で同時に実行する。",
			cpuBoundary:
				"Host は区間 CPU とプロセス全体の最大 RSS（SDK 初期化と他 Run を含む）。ランチャーと MXC は各プロセスのみ。MXC メモリは実行中の約100ms間隔で取得した PeakWorkingSet64 の最大値。Node は固定コマンドの CPU。子孫を合算した値ではない。",
			boundary:
				"Pi のシェルツール要求から完了まで。モデル通信・VS Code 描画・SDK ロード・Worktree 作成を含めない。",
			stageBoundary:
				"MXC 起動区間は CLI 起動からシェル本文の開始までで、シェル自身の初期化も含む。終了区間はシェル本文末尾から CLI の終了までで、シェル終了・拒否レポート・Sandbox 終了を含む。プロセス間の時刻は同じ PC の UTC ミリ秒、要求全体と本文は単調増加時計を使う。",
			instrumentation:
				"計測用コピーのランチャーで時刻とプロセス統計を取得し、固定コマンドから数値を受け取る。計測ファイルの書込みとサンプリングの負荷を含む。変更後も約100msのメモリサンプリングを行うが、終了イベントは待機を即座に解除する。64 KiB の固定 I/O の結果を依存インストールやモデルキャッシュの効果へ一般化しない。",
		},
		samples,
		summary: summarize(samples),
	};
}

async function runVariants(ctx: Context, persistent: boolean, trial: number) {
	const samples: Sample[] = [];
	const variants =
		trial % 2 === 1 ? ctx.variants : [...ctx.variants].reverse();
	for (const variant of variants) {
		const targets = await worktrees(
			join(ctx.root, `case-${variant.name}-${persistent}-${trial}`),
		);
		await trustTargets(ctx, targets);
		const runTarget = (cwd: string, phase: Sample["phase"]) =>
			run(ctx, { cwd, persistent, trial, phase, variant: variant.name });
		samples.push(await runTarget(targets[0]!, "first"));
		samples.push(await runTarget(targets[0]!, "repeat"));
		for (const target of targets.slice(1)) {
			samples.push(await runTarget(target, "warmup"));
		}
		samples.push(
			...(await Promise.all(
				targets.slice(1).map((target) => runTarget(target, "parallel")),
			)),
		);
	}
	return samples;
}

async function context(root: string, extension: string, baseline?: string) {
	const pi = await loadPiSdk(extension);
	const sdk = await loadMxcSdk(extension);
	const shell = {
		name: "powershell" as const,
		executable: await resolvePowerShell("powershell"),
	};
	const trust = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	const local = join(root, "local");
	await mkdir(local);
	// ユーザーが使用中のキャッシュを触らず、製品が決める保存先の基点だけを専用領域にする。
	process.env.LOCALAPPDATA = local;
	const manifest = z
		.object({ version: z.string() })
		.parse(
			JSON.parse(
				await readFile(
					join(
						extension,
						"dist/runtime/node_modules/@microsoft/mxc-sdk/package.json",
					),
					"utf8",
				),
			),
		);
	const launcher = await readFile(sdk.launcherPath, "utf8");
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const settingsManager = pi.SettingsManager.inMemory();
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({
		cwd: root,
		agentDir,
		resourceLoader,
		settingsManager,
		sessionManager: pi.SessionManager.inMemory(root),
		tools: [],
	});
	return {
		root,
		sdk,
		pi,
		shell,
		trust,
		launcher,
		variants: [
			...(baseline !== undefined
				? [{ name: "baseline" as const, source: baseline }]
				: []),
			{ name: "optimized" as const, source: launcher },
		],
		version: manifest.version,
		sequence: 0,
		session,
	};
}

async function worktrees(root: string): Promise<string[]> {
	const execute = promisify(execFile);
	const main = join(root, "main");
	await mkdir(main, { recursive: true });
	await writeFile(join(main, "probe.cjs"), probe);
	await execute("git", ["init", "--quiet", main], { windowsHide: true });
	await execute("git", ["-C", main, "add", "probe.cjs"], {
		windowsHide: true,
	});
	await execute(
		"git",
		[
			"-C",
			main,
			"-c",
			"user.name=Measurement",
			"-c",
			"user.email=measurement@example.test",
			"commit",
			"--quiet",
			"-m",
			"probe",
		],
		{ windowsHide: true },
	);
	const manager = new WorktreeManager(main, join(root, "host"));
	return [
		await realpath(main),
		(await manager.create()).root,
		(await manager.create()).root,
	];
}

async function trustTargets(ctx: Context, targets: string[]) {
	for (const target of targets) {
		await ctx.trust.setUserTrust(target, true);
	}
}

/** 本番と同じキューへ承認を返す。待機中は executor が呼ばれていないことを確認する。 */
async function run(
	ctx: Context,
	item: Pick<Run, "cwd" | "persistent" | "trial" | "phase" | "variant">,
): Promise<Sample> {
	const id = ++ctx.sequence;
	const directory = join(ctx.root, `run-${id}`);
	await mkdir(directory);
	const timingPath = join(directory, "timing.json");
	const launcherPath = join(directory, "launcher.ps1");
	await writeFile(
		launcherPath,
		instrumentLauncher(
			ctx.variants.find((variant) => variant.name === item.variant)!
				.source,
			timingPath,
		),
		"utf8",
	);
	await copyFile(
		join(dirname(ctx.sdk.launcherPath), "nerita-mxc-pipe.dll"),
		join(directory, "nerita-mxc-pipe.dll"),
	);
	const bound = bindTrustContext(ctx.trust, [item.cwd], () => true);
	try {
		return await execute(ctx, {
			...item,
			timingPath,
			launcherPath,
			trustContextId: bound.id,
		});
	} finally {
		bound.dispose();
	}
}

type Run = {
	variant: Sample["variant"];
	cwd: string;
	persistent: boolean;
	trial: number;
	phase: Sample["phase"];
	timingPath: string;
	launcherPath: string;
	trustContextId: string;
};

async function execute(ctx: Context, item: Run): Promise<Sample> {
	const state = createMeasuredExecutor(ctx, item);
	const lifetime = new AbortController();
	let approvalMs = 0;
	const authorizer = createApproval(
		lifetime,
		() => state.executeStart,
		(value) => {
			approvalMs = value;
		},
	);
	const policy = {
		workspaceRoots: [item.cwd],
		writableRoots: [item.cwd],
		shell: true,
		networkAccess: false,
		trustContextId: item.trustContextId,
	};
	const tool = createPiSandboxPowerShellTool(
		ctx.pi.createPowerShellToolDefinition(item.cwd),
		new WorkspacePathPolicy(policy, item.cwd),
		authorizer,
		state.executor,
		lifetime.signal,
		ctx.shell,
	);
	const command = probeCommand();
	let firstOutput = 0;
	const requestStarted = performance.now();
	const result = await tool.execute(
		`measure-${item.trial}`,
		{ command, timeout: 30 },
		lifetime.signal,
		() => {
			firstOutput ||= performance.now() - requestStarted;
		},
		ctx.session.extensionRunner.createToolContext(
			`measure-${item.trial}`,
			lifetime.signal,
		),
	);
	const requestMs = performance.now() - requestStarted;
	assert.ok(state.measurement, "MXC の完了計測がありません。");
	const sample = await parseProbe(result, item.timingPath, state.launchWall, {
		variant: item.variant,
		persistentCache: item.persistent,
		trial: item.trial,
		phase: item.phase,
		approvalMs,
		requestMs,
		requestPreparationMs: state.executeStart - requestStarted - approvalMs,
		requestFirstOutputMs: firstOutput,
		...state.measurement,
	});
	assert.equal(
		sample.cacheHit,
		item.persistent && ["repeat", "parallel"].includes(item.phase),
	);
	console.log(
		JSON.stringify({
			variant: item.variant,
			cache: item.persistent,
			trial: item.trial,
			phase: item.phase,
			totalMs: requestMs,
			approvalMs,
		}),
	);
	return sample;
}

function createMeasuredExecutor(ctx: Context, item: Run) {
	let executeStart = 0;
	let launchWall = 0;
	let measurement: MxcMeasurement | undefined;
	const management = new SandboxManagement(
		{ read: () => [], write: async () => {} },
		{
			read: () => ({
				grants: [],
				caches: item.persistent
					? [{ id: "measurement", workspace: item.cwd, tool: "node" }]
					: [],
			}),
			write: async () => {},
		},
	);
	const measuredSdk = {
		...ctx.sdk,
		launcherPath: item.launcherPath,
		resolveLaunch: (
			config: Parameters<typeof ctx.sdk.resolveLaunch>[0],
		) => {
			const resolved = ctx.sdk.resolveLaunch(config);
			launchWall = Date.now();
			return resolved;
		},
	};
	const executor = new MxcExecutor(
		measuredSdk,
		"base-container",
		undefined,
		undefined,
		management,
		(value) => {
			measurement = value;
		},
	);
	return {
		get executeStart() {
			return executeStart;
		},
		get launchWall() {
			return launchWall;
		},
		get measurement() {
			return measurement;
		},
		executor: {
			describe: executor.describe.bind(executor),
			execute: (...args: Parameters<MxcExecutor["execute"]>) => {
				executeStart = performance.now();
				return executor.execute(...args);
			},
		},
	};
}

function createApproval(
	lifetime: AbortController,
	executeStarted: () => number,
	record: (value: number) => void,
): ToolAuthorizer {
	const permissions = new PiPermissions(() => {});
	return async (presentation, signal) => {
		const started = performance.now();
		const pending = permissions.authorize(
			presentation,
			{ signal: lifetime.signal, cancel: () => lifetime.abort() },
			signal,
		);
		await setTimeout(approvalDelayMs);
		assert.equal(executeStarted(), 0, "承認前に executor が呼ばれました。");
		assert.equal(permissions.list().length, 1);
		assert.equal(
			permissions.respond(permissions.list()[0]!.id, "accept"),
			true,
		);
		const approved = await pending;
		record(performance.now() - started);
		return approved;
	};
}

function probeCommand() {
	return `[Console]::Out.WriteLine('SHELL_BEGIN=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()); node probe.cjs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; [Console]::Out.WriteLine('SHELL_END=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())`;
}

const probe = `const entryMs = Date.now();
const started = performance.now();
const cpu = process.cpuUsage();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.join(process.env.NPM_CONFIG_CACHE, 'fixed-probe.bin');
const expected = Buffer.alloc(65536, 17);
const hit = fs.existsSync(file);
if (!hit) fs.writeFileSync(file, expected);
const data = fs.readFileSync(file);
if (!data.equals(expected)) throw new Error('cache mismatch');
crypto.createHash('sha256').update(data).digest('hex');
const usage = process.cpuUsage(cpu);
console.log('NODE_PROBE=' + JSON.stringify({entryMs, exitMs: Date.now(), bodyMs: performance.now() - started, cacheHit: hit, cpuMs: (usage.user + usage.system) / 1000, peakRssKiB: process.resourceUsage().maxRSS}));
`;
