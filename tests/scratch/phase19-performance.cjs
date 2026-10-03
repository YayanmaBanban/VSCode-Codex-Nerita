// 一時計測は `node tests/scratch/phase19-performance.cjs <結果ラベル>` で実行する。
// 出力ストアの処理と SDK 本体による履歴読込みを別プロセスで測り、結果を dist に残す。
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { setImmediate: yieldLoop } = require("node:timers/promises");
const assert = require("node:assert/strict");

/** タイマーで観測した停止時間と、処理後のメモリを記録する。 */
async function measure(name, operation) {
	global.gc();
	const before = process.memoryUsage();
	let peakHeap = before.heapUsed;
	let lag = 0;
	let previous = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		lag = Math.max(lag, now - previous - 10);
		previous = now;
		peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
	}, 10);
	const started = performance.now();
	const result = await operation();
	const elapsed = performance.now() - started;
	peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
	await new Promise((resolve) => setTimeout(resolve, 20));
	clearInterval(timer);
	global.gc();
	const after = process.memoryUsage();
	console.log(
		JSON.stringify({
			name,
			ms: elapsed,
			maxTimerLagMs: lag,
			heapGrowthMiB: (after.heapUsed - before.heapUsed) / 1048576,
			observedPeakHeapGrowthMiB: (peakHeap - before.heapUsed) / 1048576,
			rssMiB: after.rss / 1048576,
			...result,
		}),
	);
}

/** 製品のプレビュー化と範囲取得を、同じ出力量で比較する。 */
async function stream(root, cumulative) {
	const { ToolOutputStore } = require(path.join(root, "store.cjs"));
	const { setToolOutputSource } = require(path.join(root, "source.cjs"));
	const store = new ToolOutputStore();
	let tool = {
		id: "stream",
		title: "計測",
		kind: "execute",
		status: "in_progress",
		paths: [],
	};
	const chunk = "日本語🐈\n".repeat(cumulative ? 4096 : 64);
	const count = cumulative ? 128 : 65536;
	let text = "";
	let maximumCall = 0;
	try {
		await measure(cumulative ? "cumulative" : "delta", async () => {
			for (let i = 0; i < count; i++) {
				text = cumulative ? text + chunk : chunk;
				tool = { ...tool };
				setToolOutputSource(tool, { text, delta: !cumulative });
				const started = performance.now();
				tool = store.project(tool);
				maximumCall = Math.max(
					maximumCall,
					performance.now() - started,
				);
				if (i % 64 === 0) {
					await yieldLoop();
				}
			}
			const expected = Buffer.byteLength(chunk) * count;
			let offset = 0;
			while (true) {
				const response = await store.read({
					type: "tool/output",
					requestId: "read",
					outputRef: tool.output.outputRef,
					offset,
					limit: 65536,
				});
				assert.equal(response.error, undefined);
				assert.ok(!response.text.includes("�"));
				offset = response.nextOffset;
				if (response.eof) {
					break;
				}
				await yieldLoop();
			}
			assert.equal(offset, expected);
			return {
				bytes: expected,
				updates: count,
				maximumCallMs: maximumCall,
				stateBytes: Buffer.byteLength(JSON.stringify(tool)),
			};
		});
	} finally {
		await store.dispose();
	}
}

/** SDK が通常保存する形式で、32 MiB の本文を含む履歴を用意する。 */
async function prepareHistory(root) {
	const sdk = await import(
		pathToFileURL(path.join(root, "runtime/pi.mjs")).href
	);
	const manager = sdk.SessionManager.create(root, root);
	manager.appendMessage({
		role: "user",
		content: "履歴の計測",
		timestamp: Date.now(),
	});
	const text = "日本語🐈\n".repeat(150000);
	for (let i = 0; i < 16; i++) {
		manager.appendMessage({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: `call-${i}`,
					name: "large_result",
					arguments: {},
				},
			],
			api: "openai-completions",
			provider: "local",
			model: "test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: `call-${i}`,
			toolName: "large_result",
			content: [{ type: "text", text }],
			isError: false,
			timestamp: Date.now(),
		});
	}
	await fs.writeFile(
		path.join(root, "history-path"),
		manager.getSessionFile(),
	);
}

/** 読込み・表示変換・プレビュー化を分け、どの処理が Host を止めるか測る。 */
async function history(root) {
	const sdk = await import(
		pathToFileURL(path.join(root, "runtime/pi.mjs")).href
	);
	const { restorePiHistory } = require(path.join(root, "history.cjs"));
	const { ToolOutputStore } = require(path.join(root, "store.cjs"));
	const file = await fs.readFile(path.join(root, "history-path"), "utf8");
	let manager;
	let state;
	const store = new ToolOutputStore();
	await measure("history-sdk-open", async () => {
		manager = sdk.SessionManager.open(file, root, root);
		return { fileBytes: (await fs.stat(file)).size };
	});
	await measure("history-map", async () => {
		state = restorePiHistory(manager.getBranch(), root);
		return { tools: state.tools.length };
	});
	await measure("history-project", async () => {
		state.tools = state.tools.map((tool) => store.project(tool));
		await Promise.all(
			state.tools.map((tool) =>
				store.read({
					type: "tool/output",
					requestId: "ready",
					outputRef: tool.output.outputRef,
					offset: 0,
					limit: 4,
				}),
			),
		);
		return { stateBytes: Buffer.byteLength(JSON.stringify(state)) };
	});
	await store.dispose();
}

/** 元の入力を手放した後に、短いプレビューだけで巨大本文を保持していないか測る。 */
async function retained(root) {
	const { ToolOutputStore } = require(path.join(root, "store.cjs"));
	const store = new ToolOutputStore();
	await measure("snapshot-retained", async () => {
		const tool = store.project({
			id: "large",
			title: "計測",
			kind: "execute",
			status: "completed",
			paths: [],
			rawOutput: { formatted_output: "日本語🐈".repeat(4000000) },
		});
		const response = await store.read({
			type: "tool/output",
			requestId: "ready",
			outputRef: tool.output.outputRef,
			offset: 0,
			limit: 4,
		});
		assert.equal(response.error, undefined);
		return { stateBytes: Buffer.byteLength(JSON.stringify(tool)) };
	});
	await store.dispose();
}

/** 製品コードを同じバンドルにまとめ、`WeakMap` の共有を本番と一致させる。 */
async function main() {
	if (process.argv[2] === "--worker") {
		const root = process.argv[4];
		if (process.argv[3] === "prepare") {
			return prepareHistory(root);
		}
		if (process.argv[3] === "history") {
			return history(root);
		}
		if (process.argv[3] === "retained") {
			return retained(root);
		}
		return stream(root, process.argv[3] === "cumulative");
	}
	const repo = path.resolve(__dirname, "../..");
	const root = await fs.mkdtemp(path.join(repo, "dist/phase19-perf-"));
	// 分割した CommonJS バンドルでは `WeakMap` が複製されるため、入口を1つにする。
	await fs.writeFile(
		path.join(root, "entry.ts"),
		`export { ToolOutputStore } from '${path.join(repo, "apps/vscode-nerita/src/extension/session/ToolOutputStore").replaceAll("\\", "/")}';\nexport { setToolOutputSource } from '${path.join(repo, "apps/vscode-nerita/src/extension/session/toolOutputSource").replaceAll("\\", "/")}';\nexport { restorePiHistory } from '${path.join(repo, "apps/vscode-nerita/src/extension/backends/pi/PiHistoryMapper").replaceAll("\\", "/")}';`,
	);
	await require("esbuild").build({
		entryPoints: [path.join(root, "entry.ts")],
		outfile: path.join(root, "store.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		conditions: ["nerita-source"],
	});
	await fs.writeFile(
		path.join(root, "source.cjs"),
		"module.exports = require('./store.cjs');",
	);
	await fs.writeFile(
		path.join(root, "history.cjs"),
		"module.exports = require('./store.cjs');",
	);
	await require("../../config/package-pi.cjs").bundlePi(
		repo,
		path.join(root, "runtime"),
	);
	const reports = [];
	for (const scenario of [
		"prepare",
		"delta",
		"cumulative",
		"history",
		"retained",
	]) {
		const result = spawnSync(
			process.execPath,
			["--expose-gc", __filename, "--worker", scenario, root],
			{ encoding: "utf8", windowsHide: true },
		);
		if (result.status !== 0) {
			throw new Error(result.stderr || result.stdout);
		}
		process.stdout.write(result.stdout);
		reports.push(
			...result.stdout.trim().split("\n").filter(Boolean).map(JSON.parse),
		);
	}
	await fs.writeFile(
		path.join(root, "results.json"),
		JSON.stringify(
			{ label: process.argv[2], node: process.version, reports },
			null,
			2,
		),
	);
	console.log(path.relative(repo, root));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
