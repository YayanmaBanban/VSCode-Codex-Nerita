// 導入済みの実拡張を隔離した設定でロードし、Host HTTP と承認境界を検証する。
import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
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
			fetch: { defaultMode: "raw", allowedModes: ["raw"] },
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
				'export { createPiRuntime } from "./src/extension/backends/pi/PiRuntime";',
			resolveDir: extensionPath,
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		outfile: path.join(output, "host.cjs"),
	});
	const { createPiRuntime } = createRequire(import.meta.url)(
		path.join(output, "host.cjs"),
	);
	const options = {
		extensionPath,
		cwd,
		agentDir,
		preferredModel: { provider: "local", model: "smoke" },
		signal: abort.signal,
		executor: null,
		ephemeral: true,
		authorize: (title) => {
			assert.match(title, /fetch_content/);
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
