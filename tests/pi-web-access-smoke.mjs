// 導入済みの実拡張を隔離した設定でロードし、Host HTTP と承認境界を検証する。
import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	readdir,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const extensionPath = process.cwd();
const output = path.join(extensionPath, "dist/pi-web-access-smoke");
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, "run-"));
const cwd = path.join(fixture, "workspace");
const agentDir = path.join(fixture, "agent");
await mkdir(cwd);
await mkdir(agentDir);
const installedAgent =
	process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi/agent");
const packageDir = path.join(installedAgent, "npm/node_modules/pi-web-access");
const manifest = JSON.parse(
	await readFile(path.join(packageDir, "package.json"), "utf8"),
);
const entry = await realpath(path.join(packageDir, "dist/index.js"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const report = {
	date: new Date().toISOString(),
	commit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	package: manifest.name,
	version: manifest.version,
	entry: "npm/node_modules/pi-web-access/dist/index.js",
	cases: [],
};
let requests = 0;
const marker = "Example Domain";
const url = "https://example.com/";
const httpRequests = channel("undici:request:create");
// 通信内容を差し替えず、実拡張が発行した要求の件数だけを観測する。
const observeRequest = () => {
	requests++;
};
httpRequests.subscribe(observeRequest);
const abort = new AbortController();
const timeout = setTimeout(
	() => abort.abort(new Error("HTTP検証が時間切れになりました")),
	30_000,
);
timeout.unref();
let session;
let allowed = false;
let approvals = 0;
try {
	await writeFile(
		path.join(agentDir, "settings.json"),
		JSON.stringify({ packages: [packageDir] }),
	);
	await writeFile(
		path.join(agentDir, "web-search.json"),
		JSON.stringify({
			fetch: { defaultMode: "raw", allowedModes: ["raw", "readable"] },
			githubClone: {
				clonePath: path.join(fixture, "external"),
				cloneTimeoutSeconds: 15,
			},
		}),
	);
	await writeFile(
		path.join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: "http://127.0.0.1:1/v1",
					api: "openai-completions",
					apiKey: "local-test-only",
					models: [
						{
							id: "smoke",
							reasoning: false,
							input: ["text"],
							contextWindow: 8192,
							maxTokens: 128,
						},
					],
				},
			},
		}),
	);
	await build({
		stdin: {
			contents:
				'export { createPiRuntime } from "./tests/piTrustedRuntime"; export { WorkspaceTrustStore } from "./src/extension/security/trust/WorkspaceTrustStore"; export { evaluateTrust } from "./src/extension/security/trust/TrustGate";',
			resolveDir: extensionPath,
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		outfile: path.join(output, "host.cjs"),
	});
	const { createPiRuntime, WorkspaceTrustStore, evaluateTrust } =
		createRequire(import.meta.url)(path.join(output, "host.cjs"));
	const trustStore = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	await trustStore.setUserTrust(cwd, true);
	const options = {
		extensionPath,
		cwd,
		trustStore,
		agentDir,
		preferredModel: { provider: "local", model: "smoke" },
		signal: abort.signal,
		executor: null,
		ephemeral: true,
		authorize: (title) => {
			assert.match(title.title, /fetch_content/);
			approvals++;
			return allowed
				? Promise.resolve(abort.signal)
				: Promise.reject(new Error("denied"));
		},
	};
	// パッケージ設定に存在しても、明示 Trust がなければコードを読み込まない。
	session = await createPiRuntime({ ...options, trustedExtensionPaths: [] });
	assert.ok(!session.getActiveToolNames().includes("fetch_content"));
	assert.ok(
		!session.resourceLoader
			.getExtensions()
			.extensions.some((item) => item.path === entry),
	);
	assert.equal(requests, 0);
	report.cases.push({ id: "untrusted", status: "pass" });
	await session.close();
	session = await createPiRuntime({
		...options,
		trustedExtensionPaths: [entry],
	});
	assert.ok(
		session.resourceLoader
			.getExtensions()
			.extensions.some((item) => item.path === entry),
	);
	const tool = session.agent.state.tools.find(
		(item) => item.name === "fetch_content",
	);
	assert.ok(tool);
	report.tools = session.getActiveToolNames();
	await assert.rejects(
		tool.execute("denied", { url, mode: "raw", proxy: "" }, abort.signal),
		/denied/,
	);
	assert.equal(requests, 0);
	report.cases.push({ id: "rejected-no-http", status: "pass" });
	allowed = true;
	const result = await tool.execute(
		"allowed",
		{ url, mode: "raw", proxy: "" },
		abort.signal,
	);
	assert.ok(requests > 0, JSON.stringify(result));
	assert.ok(
		JSON.stringify(result).includes(marker),
		"HTTPレスポンスがTool結果に含まれません",
	);
	assert.equal(approvals, 2);
	report.cases.push({
		id: "approved-host-http",
		status: "pass",
		requests,
		approvals,
	});
	// 公開リポジトリの取得は個人の Git 設定・認証ヘルパー・gh を使用しない。
	const gitExecutable = execFileSync("where.exe", ["git.exe"], {
		encoding: "utf8",
	})
		.trim()
		.split(/\r?\n/)[0];
	for (const name of Object.keys(process.env)) {
		if (
			name.startsWith("GIT_") ||
			["GH_TOKEN", "GITHUB_TOKEN", "SSH_ASKPASS"].includes(name)
		) {
			delete process.env[name];
		}
	}
	process.env.PATH = [
		path.dirname(gitExecutable),
		path.join(process.env.SystemRoot, "System32"),
	].join(path.delimiter);
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	process.env.GIT_CONFIG_GLOBAL = path.join(fixture, "empty-gitconfig");
	process.env.GIT_TERMINAL_PROMPT = "0";
	await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
	const cloneResult = await tool.execute(
		"clone",
		{
			url: "https://github.com/octocat/Hello-World",
			mode: "readable",
			forceClone: true,
		},
		abort.signal,
	);
	assert.ok(
		JSON.stringify(cloneResult).includes("Repository cloned to:"),
		JSON.stringify(cloneResult),
	);
	const cache = path.join(fixture, "external");
	const runtime = (await readdir(cache)).find((name) =>
		name.startsWith("runtime-"),
	);
	assert.ok(runtime);
	const repoName = (await readdir(path.join(cache, runtime))).find((name) =>
		/^[0-9a-f]{64}$/.test(name),
	);
	assert.ok(repoName);
	const repo = path.join(cache, runtime, repoName);
	assert.equal(await trustStore.trusted(repo), false);
	await assert.rejects(
		evaluateTrust({
			tool: "powershell",
			params: { command: "pnpm test" },
			command: ["powershell", "pnpm test"],
			cwd: repo,
			policy: session.accessPolicy,
		}),
		/未信頼/,
	);
	report.cases.push({ id: "real-clone-untrusted", status: "pass" });
	await session.close();
	session = await createPiRuntime({
		...options,
		workspaceTrusted: false,
		trustedExtensionPaths: [entry],
	});
	const rawTool = session.agent.state.tools.find(
		(item) => item.name === "fetch_content",
	);
	assert.ok(rawTool);
	const publicResult = await rawTool.execute(
		"untrusted-raw",
		{ url, mode: "raw" },
		abort.signal,
	);
	assert.ok(JSON.stringify(publicResult).includes(marker));
	await assert.rejects(
		rawTool.execute(
			"untrusted-readable",
			{ url, mode: "readable" },
			abort.signal,
		),
		/未信頼/,
	);
	report.cases.push({ id: "untrusted-public-raw-only", status: "pass" });
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	report.cases.push({
		id: "execution",
		status: "fail",
		error: String(error)
			.replaceAll(fixture, "<fixture>")
			.replaceAll(packageDir, "<package>"),
	});
	process.exitCode = 1;
	console.error(report.cases.at(-1).error);
} finally {
	clearTimeout(timeout);
	abort.abort();
	await session?.close();
	httpRequests.unsubscribe(observeRequest);
	await writeFile(
		path.join(output, "results.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	if (originalAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	}
}
