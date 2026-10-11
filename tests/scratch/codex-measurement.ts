// 同梱 Codex 本体の接続・永続セッション作成・Sandbox コマンドを main/A/B で計測する。
// モデルのターンは開始せず、検証が作ったセッションとプロセスだけを回収する。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { cpus, homedir, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { parse } from "smol-toml";
import { z } from "zod";
import { isRecord } from "@nerita/shared/validation";
import { CodexClient } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexClient";
import { AppServerRpcError } from "../../apps/vscode-nerita/src/extension/backends/codex/protocol/rpcMessage";
import { WorktreeManager } from "../../apps/vscode-nerita/src/extension/dlc/WorktreeManager";
import { commandEnvironment } from "../../apps/vscode-nerita/src/extension/runtime/CommandEnvironment";
import { resolvePowerShell } from "../../apps/vscode-nerita/src/extension/runtime/PowerShellExecutable";
import { fsErrorCode } from "../../apps/vscode-nerita/src/extension/runtime/FsError";
import {
	traces,
	parseOutput,
	probeSource,
	shellCommand,
	summarize,
	type Trace,
	type Sample,
	type Failure,
} from "./codex-measurement-support";

const execute = promisify(execFile);
type Context = Awaited<ReturnType<typeof connect>>;

/** 新しい Worktree を各組に用意し、キャッシュの実行順を交互にする。 */
export async function measure(
	root: string,
	extensionPath: string,
	repetitions: number,
) {
	// Desktop が使用中のランタイムと、検証のローカルデータを混在させない。
	const local = join(root, "local");
	await mkdir(local);
	process.env.LOCALAPPDATA = local;
	const shell = await resolvePowerShell("powershell");
	const config = await sessionConfig();
	const security = await verifyBoundary(root, extensionPath, config);
	const samples: Sample[] = [];
	const failures: Failure[] = [];
	const connections: Awaited<ReturnType<typeof finish>>[] = [];
	for (let trial = 1; trial <= repetitions; trial++) {
		for (const persistentCache of trial % 2 === 1
			? [false, true]
			: [true, false]) {
			const result = await runCase({
				root,
				extensionPath,
				config,
				trial,
				persistentCache,
				shell,
			});
			samples.push(...result.samples);
			connections.push(...result.connections);
			failures.push(...result.failures);
		}
	}
	const summary = summarize(samples).map((group) => {
		const failureCount = failures.filter(
			(failure) =>
				failure.phase === group.phase &&
				failure.persistentCache === group.persistentCache,
		).length;
		return {
			...group,
			failureCount,
			attemptCount: group.count + failureCount,
		};
	});
	return {
		status:
			failures.length === 0
				? "succeeded"
				: "completed-with-command-failures",
		environment: environment(repetitions),
		security,
		samples,
		connections,
		failures,
		attempts: samples.length + failures.length,
		summary,
	};
}

async function runCase(
	item: Omit<Run, "target" | "phase"> & {
		root: string;
		extensionPath: string;
		config: Awaited<ReturnType<typeof sessionConfig>>;
	},
) {
	const contexts: Context[] = [];
	const samples: Sample[] = [];
	const connections: Awaited<ReturnType<typeof finish>>[] = [];
	const failures: Failure[] = [];
	try {
		const targets = await worktrees(
			join(item.root, `case-${item.trial}-${item.persistentCache}`),
		);
		const main = await connect(
			item.extensionPath,
			targets[0]!,
			item.config,
		);
		contexts.push(main);
		for (const phase of ["first", "repeat"] as const) {
			const result = await attempt(
				main,
				{ ...item, target: "main", phase },
				failures,
			);
			if (result !== undefined) {
				samples.push(result);
			}
		}
		// 片方の接続失敗でも、他方の成功した接続を finally で回収する。
		const parallel = await Promise.allSettled(
			targets.slice(1).map(async (cwd, index) => {
				const ctx = await connect(item.extensionPath, cwd, item.config);
				contexts.push(ctx);
				return {
					ctx,
					target: index === 0 ? ("A" as const) : ("B" as const),
				};
			}),
		);
		const pair = parallel.map(fulfilled);
		for (const phase of ["parallelFirst", "parallelRepeat"] as const) {
			const runs = await Promise.allSettled(
				pair.map(({ ctx, target }) =>
					attempt(ctx, { ...item, target, phase }, failures),
				),
			);
			samples.push(
				...runs.map(fulfilled).filter((value) => value !== undefined),
			);
		}
		const native = await processStatistics(contexts, item.shell);
		for (const ctx of contexts) {
			connections.push(
				await finish(ctx, native, item.trial, item.persistentCache),
			);
		}
		return { samples, connections, failures };
	} finally {
		await disposeAll(contexts);
	}
}

function fulfilled<T>(result: PromiseSettledResult<T>): T {
	if (result.status === "rejected") {
		throw result.reason;
	}
	return result.value;
}

async function disposeAll(contexts: Context[]) {
	const results = await Promise.allSettled(
		contexts.map((ctx) => dispose(ctx)),
	);
	results.map(fulfilled);
}

function environment(repetitions: number) {
	return {
		platform: process.platform,
		architecture: process.arch,
		windows: release(),
		node: process.versions.node,
		cpu: cpus()[0]?.model,
		logicalCpus: cpus().length,
		memoryGiB: totalmem() / 1024 ** 3,
		repetitions,
		boundary:
			"同梱の `CodexClient`・JSON Worker・App Server 本体を使用する。接続・設定取得・起動準備の確認・永続セッション作成・コマンド実行・終了を別々に測る。モデルのターン・承認待ち・VS Code の描画・Worktree の作成を含めない。",
		settings:
			"既存の `CODEX_HOME` と elevated モードの Windows Sandbox を使用する。セットアップは行わない。`LOCALAPPDATA` の基点だけを検証専用領域にする。MCP はセッション作成時の設定で無効化する。モデルの推論要求は送らない。メタデータの取得・既存モデルカタログの影響は `sessionMs` に含む。0.162.0 の Windows Sandbox はコマンド実行のストリーミングに対応していないため、出力は完了応答で取得する。",
		cache: "64 KiB の固定ファイルの保持だけを検証する。各作業ディレクトリ配下の専用領域を `NPM_CONFIG_CACHE` に指定する。Codex 内部・モデル・依存関係のインストールに使うキャッシュの効果ではない。",
		first: "新しい Worktree・App Server・セッションでの初回実行。OS を再起動した直後の計測ではない。repeat は同じ接続とセッションを再利用する。A/B は接続とセッションを同時に作成後、コマンドを同時に要求する。",
		cpuBoundary:
			"Host は各コマンド区間の CPU とプロセス全体の最大 RSS。並列の他 Run を含む。App Server は接続後から全コマンド終了までの自身の累積 CPU と最大 RSS。子孫は合算しない。Node は固定 I/O の CPU と最大 RSS。",
		instrumentation:
			"計測用コピーの `CodexClient` に時刻と PID の取得だけを挿入する。送信・受信・Worker・検証・終了には製品の実装を使用する。数値の記録による負荷を含む。プロセス間の時刻は同じ PC の UTC ミリ秒、Host の区間は単調増加時計を使う。各区間の中央値の和は全体の中央値とは一致しない。",
		failures:
			"OS による EPERM/EACCES の拒否は、条件・待ち時間を `failures` に記録して計測を続行し、自動再試行しない。中央値は成功した試行だけの値で、`failureCount` と `attemptCount` を併記する。他の通信障害・検証失敗があれば計測を中止する。キャッシュは Sandbox 内の固定コマンドが作成し、Host は存在確認だけを行う。",
	};
}

/** ユーザー設定は読み取るだけで、接続先の名前や内容を成果物へ残さない。 */
async function sessionConfig(): Promise<Record<string, string | boolean>> {
	let servers: unknown;
	try {
		const configHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
		servers = parse(
			await readFile(join(configHome, "config.toml"), "utf8"),
		).mcp_servers;
	} catch (error) {
		if (fsErrorCode(error) !== "ENOENT") {
			throw error;
		}
	}
	const config: Record<string, string | boolean> = { web_search: "disabled" };
	for (const name of Object.keys(isRecord(servers) ? servers : {})) {
		assert.match(
			name,
			/^[\w-]+$/,
			"MCP の設定キーを安全に上書きできません。",
		);
		config[`mcp_servers.${name}.enabled`] = false;
	}
	return config;
}

async function worktrees(root: string) {
	const main = join(root, "main");
	await mkdir(main, { recursive: true });
	await writeFile(join(main, "probe.cjs"), probeSource);
	const commands = [
		["init", "--quiet", main],
		["-C", main, "add", "probe.cjs"],
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
	];
	for (const args of commands) {
		await execute("git", args, { windowsHide: true });
	}
	const manager = new WorktreeManager(main, join(root, "host"));
	return [
		await realpath(main),
		(await manager.create()).root,
		(await manager.create()).root,
	];
}

async function connect(
	extensionPath: string,
	cwd: string,
	config: Awaited<ReturnType<typeof sessionConfig>>,
) {
	const trace: Trace = { marks: { started: performance.now() } };
	const client = await traces.run(trace, () =>
		CodexClient.connect({
			extensionPath,
			cwd,
			windowsSandbox: "elevated",
			signal: AbortSignal.timeout(30000),
			clientInfo: {
				name: "nerita_codex_measurement",
				title: null,
				version: "0.0.1",
			},
		}),
	);
	const connected = performance.now();
	let threadId: string | undefined;
	try {
		assert.equal((await client.readSandboxConfig(cwd)).sandbox, "elevated");
		assert.equal((await client.readSandboxReadiness()).status, "ready");
		const ready = performance.now();
		const thread = await client.startThread({
			cwd,
			sandbox: "workspace-write",
			approvalPolicy: "on-request",
			config,
		});
		threadId = thread.thread.id;
		const sessionReady = performance.now();
		assert.equal(await realpath(thread.cwd), cwd);
		return {
			client,
			trace,
			cwd,
			connected,
			ready,
			sessionReady,
			threadId: thread.thread.id,
			closed: false,
		};
	} catch (error) {
		try {
			if (threadId !== undefined) {
				await removeThread(client, threadId);
			}
		} finally {
			await client.dispose();
		}
		throw error;
	}
}

type Run = Pick<Sample, "trial" | "persistentCache" | "target" | "phase"> & {
	shell: string;
};

/** OS による拒否だけを結果へ残し、通信障害や検証の不一致は成功扱いにしない。 */
async function attempt(ctx: Context, item: Run, failures: Failure[]) {
	const started = performance.now();
	try {
		return await run(ctx, item);
	} catch (error) {
		if (
			!(error instanceof AppServerRpcError) ||
			!/EPERM|EACCES/.test(error.message)
		) {
			throw error;
		}
		const failure: Failure = {
			trial: item.trial,
			persistentCache: item.persistentCache,
			target: item.target,
			phase: item.phase,
			category: "permissionDenied",
			elapsedMs: performance.now() - started,
		};
		failures.push(failure);
		console.log(JSON.stringify({ failure }));
		return undefined;
	}
}

async function run(ctx: Context, item: Run): Promise<Sample> {
	const cache = join(
		ctx.cwd,
		item.persistentCache ? "cache-held" : `cache-${randomUUID()}`,
	);
	const expectedHit = await cacheExists(join(cache, "fixed-probe.bin"));
	const cpu = process.cpuUsage();
	const requestStarted = performance.now();
	const wall = Date.now();
	const result = await ctx.client.executeCommand({
		command: [
			item.shell,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			shellCommand,
		],
		cwd: ctx.cwd,
		processId: randomUUID(),
		timeoutMs: 15000,
		env: {
			...commandEnvironment(),
			NPM_CONFIG_CACHE: cache,
			NERITA_MEASUREMENT_NODE: process.execPath,
			NERITA_MEASUREMENT_CWD: ctx.cwd,
		},
		sandboxPolicy: {
			type: "workspaceWrite",
			writableRoots: [ctx.cwd],
			networkAccess: false,
			excludeTmpdirEnvVar: true,
			excludeSlashTmp: true,
		},
	});
	const responseAt = performance.now();
	const commandMs = responseAt - requestStarted;
	const responseWall = Date.now();
	const usedCpu = process.cpuUsage(cpu);
	assert.equal(result.exitCode, 0, result.stderr);
	assert.equal(result.stderr, "");
	const output = parseOutput(result.stdout);
	assert.equal(output.node.hit, expectedHit);
	const sample: Sample = {
		trial: item.trial,
		persistentCache: item.persistentCache,
		target: item.target,
		phase: item.phase,
		cacheHit: output.node.hit,
		metrics: commandMetrics(ctx, item, {
			commandMs,
			responseAt,
			responseWall,
			usedCpu,
			wall,
			output,
		}),
	};
	console.log(
		JSON.stringify({
			trial: item.trial,
			cache: item.persistentCache,
			target: item.target,
			phase: item.phase,
			commandMs,
			startupToCommandMs: sample.metrics.startupToCommandMs,
		}),
	);
	return sample;
}

async function cacheExists(file: string) {
	try {
		await access(file);
		return true;
	} catch (error) {
		if (fsErrorCode(error) !== "ENOENT") {
			throw error;
		}
		return false;
	}
}

function commandMetrics(
	ctx: Context,
	item: Run,
	measurement: {
		commandMs: number;
		responseAt: number;
		responseWall: number;
		usedCpu: NodeJS.CpuUsage;
		wall: number;
		output: ReturnType<typeof parseOutput>;
	},
) {
	const { commandMs, responseAt, responseWall, usedCpu, wall, output } =
		measurement;
	const fresh = item.phase === "first" || item.phase === "parallelFirst";
	return {
		commandMs,
		connectionMs: fresh ? ctx.connected - ctx.trace.marks.started! : 0,
		readinessMs: fresh ? ctx.ready - ctx.connected : 0,
		sessionMs: fresh ? ctx.sessionReady - ctx.ready : 0,
		startupToCommandMs: fresh
			? responseAt - ctx.trace.marks.started!
			: commandMs,
		fixturePreparationMs: fresh
			? responseAt - ctx.sessionReady - commandMs
			: 0,
		requestToShellBodyMs: output.shellBegin - wall,
		shellBodyMs: output.shellEnd - output.shellBegin,
		shellToNodeMs: output.node.entryMs - output.shellBegin,
		nodeBodyMs: output.node.workMs,
		nodeToShellEndMs: output.shellEnd - output.node.finishedMs,
		shellEndToResponseMs: responseWall - output.shellEnd,
		hostCpuMs: (usedCpu.user + usedCpu.system) / 1000,
		hostPeakRssKiB: process.resourceUsage().maxRSS,
		nodeCpuMs: output.node.cpuMs,
		nodePeakRssKiB: output.node.rssKiB,
	};
}

/** OS 統計の読み取りは全コマンドの計測後に行い、起動区間への負荷を避ける。 */
async function processStatistics(contexts: Context[], shell: string) {
	const pids = contexts.map((ctx) => {
		const pid = ctx.trace.child?.pid;
		assert.ok(pid !== undefined && Number.isSafeInteger(pid) && pid > 0);
		return pid;
	});
	const script = `@(${pids.join(",")}) | ForEach-Object { $measured = [Diagnostics.Process]::GetProcessById($_); $measured.Refresh(); [Console]::Out.WriteLine(('{"pid":' + $_ + ',"cpuMs":' + $measured.TotalProcessorTime.TotalMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture) + ',"peakRssKiB":' + ($measured.PeakWorkingSet64 / 1024).ToString([Globalization.CultureInfo]::InvariantCulture) + '}')) }`;
	const result = await execute(
		shell,
		["-NoProfile", "-NonInteractive", "-Command", script],
		{ windowsHide: true },
	);
	return result.stdout
		.trim()
		.split(/\r?\n/)
		.map((line) =>
			z
				.object({
					pid: z.number().int().positive(),
					cpuMs: z.number().nonnegative(),
					peakRssKiB: z.number().nonnegative(),
				})
				.parse(JSON.parse(line)),
		);
}

async function finish(
	ctx: Context,
	native: Awaited<ReturnType<typeof processStatistics>>,
	trial: number,
	persistentCache: boolean,
) {
	const usage = native.find((value) => value.pid === ctx.trace.child?.pid);
	assert.ok(usage);
	const started = performance.now();
	await dispose(ctx);
	const marks = ctx.trace.marks;
	return {
		trial,
		persistentCache,
		target: ctx.cwd.endsWith("main") ? "main" : "worktree",
		connectionMs: ctx.connected - marks.started!,
		resolverMs: marks.resolved! - marks.started!,
		spawnMs: marks.spawned! - marks.resolved!,
		transportSetupMs: marks.transportReady! - marks.spawned!,
		initializeMs: marks.initialized! - marks.transportReady!,
		readinessMs: ctx.ready - ctx.connected,
		sessionMs: ctx.sessionReady - ctx.ready,
		cleanupMs: performance.now() - started,
		cpuMs: usage.cpuMs,
		peakRssKiB: usage.peakRssKiB,
	};
}

/** 計測前の別 cwd で OS 拒否を確認する。計測対象の初回をウォームアップしない。 */
async function verifyBoundary(
	root: string,
	extensionPath: string,
	config: Awaited<ReturnType<typeof sessionConfig>>,
) {
	const cwd = join(root, "boundary");
	const outside = join(root, "outside.txt");
	await mkdir(cwd);
	await writeFile(outside, "original");
	await writeFile(
		join(cwd, "denied.cjs"),
		`require('node:fs').writeFileSync(${JSON.stringify(outside)}, 'changed')`,
	);
	const ctx = await connect(extensionPath, await realpath(cwd), config);
	try {
		await assert.rejects(
			ctx.client.executeCommand({
				command: [process.execPath, "denied.cjs"],
				cwd,
				timeoutMs: 15000,
				env: commandEnvironment(),
				sandboxPolicy: {
					type: "workspaceWrite",
					writableRoots: [cwd],
					networkAccess: false,
					excludeTmpdirEnvVar: true,
					excludeSlashTmp: true,
				},
			}),
			/EPERM|EACCES|sandbox denied/i,
		);
		assert.equal(await readFile(outside, "utf8"), "original");
		return {
			outsideWriteDenied: true,
			sandbox: "elevated",
			networkAccess: false,
		};
	} finally {
		await dispose(ctx);
	}
}

/** 自分が作った永続 Thread のみ archive/delete し、失敗時も App Server を回収する。 */
async function dispose(ctx: Context) {
	if (ctx.closed) {
		return;
	}
	ctx.closed = true;
	try {
		await removeThread(ctx.client, ctx.threadId);
	} finally {
		await ctx.client.dispose();
		assert.ok(ctx.trace.child);
		assert.ok(
			ctx.trace.child.exitCode !== null ||
				ctx.trace.child.signalCode !== null,
		);
	}
}

async function removeThread(client: CodexClient, threadId: string) {
	await client.archiveThread(threadId);
	await client.deleteThread(threadId);
}

/** 失敗した試行の復旧用。呼び出し側が確定した専用 cwd だけを対象にする。 */
export async function recover(extensionPath: string, cwd: string) {
	const trace: Trace = { marks: { started: performance.now() } };
	const client = await traces.run(trace, () =>
		CodexClient.connect({
			extensionPath,
			cwd: extensionPath,
			windowsSandbox: "elevated",
			clientInfo: {
				name: "nerita_codex_measurement",
				title: null,
				version: "0.0.1",
			},
		}),
	);
	let count = 0;
	try {
		for (const archived of [false, true]) {
			const result = await client.listThreads({
				cwd,
				archived,
				limit: 100,
				useStateDbOnly: true,
			});
			for (const thread of result.data) {
				assert.equal(thread.cwd.toLowerCase(), cwd.toLowerCase());
				await recoverThread(client, thread.id, archived);
				count++;
			}
			assert.equal(result.nextCursor, null);
		}
		console.log(JSON.stringify({ recoveredThreads: count }));
	} finally {
		await client.dispose();
	}
}

async function recoverThread(
	client: CodexClient,
	threadId: string,
	archived: boolean,
) {
	if (!archived) {
		await client.archiveThread(threadId);
	}
	await client.deleteThread(threadId);
}
