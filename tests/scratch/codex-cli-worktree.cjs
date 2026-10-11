// node tests/scratch/codex-cli-worktree.cjs で CLI 本体の --worktree とターン内のシェル実行を検証する。
// 既存 Sandbox のまま一時 Git リポジトリを使用し、CLI の終了と作業領域を回収する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createHash } = require("node:crypto");
const { parse } = require("smol-toml");
const { repoRoot } = require("../../config/workspace-paths.cjs");
const { modelServer } = require("./codex-cli-model.cjs");
const { cleanup } = require("./codex-cli-cleanup.cjs");
const execute = promisify(execFile);
const binary = path.join(
	repoRoot,
	"apps/vscode-nerita/dist/runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
);

/** 一時領域と CLI の所有記録を保持し、成功・失敗の両方で回収する。 */
async function main() {
	assert.equal(process.platform, "win32");
	if (process.argv.includes("--recover")) {
		await recover();
		return;
	}
	const temporary = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-codex-cli-"),
	);
	const model = await modelServer(
		`Write-Output ('CLI_CWD=' + (Get-Location).Path); & '${process.execPath.replaceAll("'", "''")}' probe.cjs`,
	);
	const destination = path.join(
		repoRoot,
		"dist/measurements",
		new Date().toISOString().replaceAll(":", "-"),
	);
	await fs.mkdir(destination, { recursive: true });
	const owned = { sourceLeaf: path.basename(temporary), targets: [] };
	let managedRoot;
	try {
		const source = await prepare(temporary);
		const config = await overrides(model.url);
		managedRoot = config.managedRoot;
		const tracking = {
			owned,
			managedRoot,
			destination,
			saved: Promise.resolve(),
		};
		const samples = await sampleCases(source, config.args, tracking);
		assert.deepEqual(model.failures, []);
		assert.ok(
			samples.every((sample) => sample.category !== "unexpectedFailure"),
		);
		await saveResult(destination, samples, model, tracking);
	} finally {
		await model.close();
		if (owned.targets.length > 0) {
			console.log(
				`検証用 Thread 回収: ${await cleanup(binary, repoRoot, managedRoot, owned)}`,
			);
		}
		assert.equal(path.dirname(temporary), os.tmpdir());
		assert.match(path.basename(temporary), /^nerita-codex-cli-[a-z\d]+$/i);
		assert.equal((await fs.lstat(temporary)).isSymbolicLink(), false);
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

/** 中断した検証の明示的な ID 記録だけを使用する。 */
async function recover() {
	const file = path.resolve(repoRoot, process.argv[3]);
	const relative = path.relative(
		path.join(repoRoot, "dist/measurements"),
		file,
	);
	assert.ok(
		relative && !relative.startsWith("..") && !path.isAbsolute(relative),
	);
	const record = JSON.parse(await fs.readFile(file, "utf8"));
	const settings = await overrides("http://127.0.0.1:9/v1");
	console.log(
		`検証用 Thread 回収: ${await cleanup(binary, repoRoot, settings.managedRoot, record)}`,
	);
}

/** 既定環境は単独と A/B を1組、検証用 LOCALAPPDATA では A/B を5組観測する。 */
async function sampleCases(source, config, tracking) {
	const samples = [];
	const smoke = process.argv.includes("--smoke");
	for (const isolatedLocalData of smoke ? [false] : [false, true]) {
		const local = path.join(path.dirname(source), "local");
		await fs.mkdir(local, { recursive: true });
		const environment = { ...process.env };
		if (isolatedLocalData) {
			environment.LOCALAPPDATA = local;
		}
		const single = await run(source, config, environment, tracking);
		samples.push({
			isolatedLocalData,
			target: "single",
			trial: 0,
			...single,
		});
		console.log(JSON.stringify(samples.at(-1)));
		const repetitions = smoke || !isolatedLocalData ? 1 : 5;
		for (let trial = 1; trial <= repetitions; trial++) {
			await sampleParallel(
				{
					source,
					config,
					environment,
					tracking,
					isolatedLocalData,
					trial,
				},
				samples,
			);
		}
	}
	return samples;
}

/** 片方の失敗でも、先に両プロセスの終了と所有記録の保存を待つ。 */
async function sampleParallel(item, samples) {
	const results = await Promise.allSettled(
		[0, 1].map(() =>
			run(item.source, item.config, item.environment, item.tracking),
		),
	);
	for (const [index, result] of results.entries()) {
		assert.equal(result.status, "fulfilled");
		const sample = {
			isolatedLocalData: item.isolatedLocalData,
			target: index === 0 ? "A" : "B",
			trial: item.trial,
			...result.value,
		};
		samples.push(sample);
		console.log(JSON.stringify(sample));
	}
}

/** 認証情報・絶対パス・生の会話を含まない結果だけを保存する。 */
async function saveResult(destination, samples, model, tracking) {
	const requested = await Promise.all(
		model.observations
			.filter((entry) => entry.workdir)
			.map(async (entry) =>
				(await fs.realpath(entry.workdir)).toLowerCase(),
			),
	);
	const expected = tracking.owned.targets.map((target) =>
		path.join(tracking.managedRoot, target.cwdRelative).toLowerCase(),
	);
	assert.deepEqual(requested.sort(), expected.sort());
	const version = await execute(binary, ["--version"], {
		windowsHide: true,
	});
	await fs.writeFile(
		path.join(destination, "codex-cli.json"),
		JSON.stringify(
			{
				version: version.stdout.trim(),
				platform: process.platform,
				windows: os.release(),
				route: "CLI 本体の exec --worktree → thread/start → turn/start → シェルツール。モデルの `Responses API` とモデルカタログだけをローカルの固定応答に置換。",
				sandbox:
					"elevated / workspace-write。既存の `CODEX_HOME` と CLI の Worktree 保存先を使用。環境変数ポリシーは CLI の既存設定。Sandbox の新規セットアップ・ユーザー設定の変更なし。",
				command:
					"PowerShell → Node → cwd 配下への 64 KiB 固定ファイル作成・読戻し",
				samples,
				modelRequests: model.observations.length,
				requestedWorkdirsMatched: true,
				diagnosticScope:
					"Sandbox 診断は同時間帯の共有 Native ログ。個々の PID との対応は行わない。成功判定はツール終了コード・cwd・実ファイルで行う。",
			},
			null,
			2,
		),
	);
	console.log(
		`検証結果: ${path.relative(repoRoot, destination)}/codex-cli.json`,
	);
}

async function prepare(root) {
	const source = path.join(root, "main");
	await fs.mkdir(source);
	await fs.writeFile(
		path.join(source, "probe.cjs"),
		`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cwd = fs.realpathSync(process.cwd());
if (!fs.existsSync(path.join(cwd, '.git'))) throw new Error('missing worktree');
const file = path.join(cwd, 'cache', 'fixed-probe.bin');
fs.mkdirSync(path.dirname(file), {recursive: true});
const data = Buffer.alloc(64 * 1024, 17);
fs.writeFileSync(file, data);
if (!fs.readFileSync(file).equals(data)) throw new Error('content mismatch');
console.log('CLI_PROBE=' + JSON.stringify({cwd, sha256: crypto.createHash('sha256').update(data).digest('hex')}));
`,
	);
	for (const args of [
		["init", "--quiet", source],
		["-C", source, "add", "probe.cjs"],
		[
			"-C",
			source,
			"-c",
			"user.name=Probe",
			"-c",
			"user.email=probe@example.test",
			"commit",
			"--quiet",
			"-m",
			"probe",
		],
	]) {
		await execute("git", args, { windowsHide: true });
	}
	return source;
}

async function overrides(url) {
	const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
	const parsed = parse(
		await fs.readFile(path.join(home, "config.toml"), "utf8"),
	);
	const values = {
		"windows.sandbox": "elevated",
		model_provider: "nerita_probe",
		model: "gpt-5.4",
		"model_providers.nerita_probe": {
			name: "Nerita local probe",
			base_url: url,
			wire_api: "responses",
			requires_openai_auth: false,
		},
		approval_policy: "never",
		web_search: "disabled",
	};
	for (const name of Object.keys(parsed.mcp_servers ?? {})) {
		assert.match(name, /^[\w-]+$/);
		values[`mcp_servers.${name}.enabled`] = false;
	}
	return {
		managedRoot: await fs.realpath(
			parsed.desktop?.["git-worktree-root"]?.trim() ||
				path.join(home, "worktrees"),
		),
		args: Object.entries(values).flatMap(([key, value]) => [
			"-c",
			`${key}=${toml(value)}`,
		]),
	};
}

function toml(value) {
	if (typeof value !== "object") {
		return JSON.stringify(value);
	}
	return `{${Object.entries(value)
		.map(([key, entry]) => `${key}=${toml(entry)}`)
		.join(",")}}`;
}

/** CLI の終了コードだけでなく、ツールの終了コードと実ファイルを検証する。 */
async function run(source, config, env, tracking) {
	const started = performance.now();
	const wallStarted = Date.now();
	const { exitCode, events, stderr } = await runCLI(source, config, env);
	const threadId = events.find(
		(event) => event.type === "thread.started",
	)?.thread_id;
	assert.equal(typeof threadId, "string");
	const target = await recordTarget(source, threadId, tracking);
	const commands = events
		.filter(
			(event) =>
				event.type === "item.completed" &&
				event.item?.type === "command_execution",
		)
		.map((event) => event.item);
	const output = commands
		.map((item) => item.aggregated_output ?? "")
		.join("\n");
	const marker = output
		.split(/\r?\n/)
		.find((line) => line.startsWith("CLI_PROBE="));
	const passed =
		exitCode === 0 &&
		commands.length === 1 &&
		commands[0].exit_code === 0 &&
		Boolean(marker);
	if (passed) {
		await verifyOutput(marker, target);
	}
	const diagnostics = await sandboxDiagnostics(wallStarted);
	const category = classifyFailure(
		passed,
		`${stderr}\n${output}`,
		diagnostics,
	);
	const outsideSourceUnchanged = !(await exists(path.join(source, "cache")));
	assert.ok(outsideSourceUnchanged);
	return {
		exitCode,
		commandCount: commands.length,
		commandExitCode: commands[0]?.exit_code ?? null,
		category,
		diagnostics,
		elapsedMs: performance.now() - started,
		outsideSourceUnchanged,
	};
}

/** CLI 本体を起動し、期限超過時も自分が起動したプロセスの子孫だけを止める。 */
async function runCLI(source, config, env) {
	const child = spawn(
		binary,
		[
			"exec",
			"--worktree",
			"--json",
			"--color",
			"never",
			"--sandbox",
			"workspace-write",
			"-C",
			source,
			...config,
			"Run the fixed probe once and report completion.",
		],
		{
			cwd: source,
			env,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const timer = setTimeout(() => {
		void execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
			windowsHide: true,
		}).catch(() => {});
	}, 45000);
	let exitCode;
	try {
		exitCode = await new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("close", resolve);
		});
	} finally {
		clearTimeout(timer);
	}
	const events = stdout
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	return { exitCode, events, stderr };
}

/** Worktree の実体と、Sandbox 内で作成した内容を Host から再確認する。 */
async function verifyOutput(marker, target) {
	const probe = JSON.parse(marker.slice("CLI_PROBE=".length));
	assert.equal(
		(await fs.realpath(probe.cwd)).toLowerCase(),
		target.toLowerCase(),
	);
	const expected = createHash("sha256")
		.update(Buffer.alloc(64 * 1024, 17))
		.digest("hex");
	assert.equal(probe.sha256, expected);
	assert.equal(
		createHash("sha256")
			.update(
				await fs.readFile(path.join(target, "cache/fixed-probe.bin")),
			)
			.digest("hex"),
		expected,
	);
}

/** Native の拒否を成功扱いにせず、共有ログの観測範囲も区別する。 */
function classifyFailure(passed, output, diagnostics) {
	if (passed) {
		return "success";
	}
	const text = output.replaceAll("\0", "");
	if (/EPERM|EACCES/.test(text)) {
		return "permissionDenied";
	}
	if (/setup refresh had errors/.test(text)) {
		return diagnostics.runtimeSharingViolation
			? "runtimeLocked"
			: "sandboxSetupFailed";
	}
	if (/8009001d/i.test(text)) {
		return "powerShellInitializationFailed";
	}
	if (
		/CLI_CWD=/.test(text) &&
		/Cannot find module '[a-z]:\\probe\.cjs'/i.test(text)
	) {
		return "childCwdMismatch";
	}
	console.error(text.slice(-5000));
	return "unexpectedFailure";
}

async function recordTarget(source, threadId, tracking) {
	const listing = await execute(
		"git",
		["-C", source, "worktree", "list", "--porcelain", "-z"],
		{ windowsHide: true },
	);
	for (const field of listing.stdout.split("\0")) {
		if (!field.startsWith("worktree ")) {
			continue;
		}
		const cwd = await fs.realpath(field.slice("worktree ".length));
		const relative = path.relative(tracking.managedRoot, cwd);
		if (!/^[a-f\d]{4}[\\/]main$/i.test(relative)) {
			continue;
		}
		const linked = (
			await fs.readFile(path.join(cwd, ".git"), "utf8")
		).trim();
		const gitDir = linked.slice("gitdir: ".length);
		assert.match(
			path.relative(path.join(source, ".git/worktrees"), gitDir),
			/^[^\\/]+$/,
		);
		const owner = JSON.parse(
			await fs.readFile(path.join(gitDir, "codex-thread.json"), "utf8"),
		);
		if (owner.ownerThreadId !== threadId) {
			continue;
		}
		tracking.owned.targets.push({ threadId, cwdRelative: relative });
		tracking.saved = tracking.saved.then(() =>
			fs.writeFile(
				path.join(tracking.destination, "codex-cli-owned.json"),
				JSON.stringify(tracking.owned, null, 2),
			),
		);
		await tracking.saved;
		return cwd;
	}
	throw new Error(
		"CLI が作成した Thread と Worktree の所有記録が一致しません。",
	);
}

async function sandboxDiagnostics(started) {
	const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
	const log = path.join(
		home,
		".sandbox",
		`sandbox.${new Date().toISOString().slice(0, 10)}.log`,
	);
	const text = (await fs.readFile(log, "utf8"))
		.split("\n")
		.filter((line) => {
			const timestamp = line.match(/^\[([^\]]+)\]/)?.[1];
			return timestamp && Date.parse(timestamp) >= started;
		})
		.join("\n");
	return {
		runtimeSharingViolation:
			/runtime read\/execute validation failed.*os error 32/.test(text),
		setupRefreshFailed: /setup refresh completed with errors/.test(text),
	};
}

async function exists(file) {
	try {
		await fs.access(file);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
