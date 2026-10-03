// 一時計測は `node --expose-gc tests/scratch/codex-history-performance.cjs <ラベル>` で実行する。
// App Server のページ応答だけを合成し、JSON 解析から出力退避までの Host 側の処理を比較する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { setImmediate: yieldLoop } = require("node:timers/promises");

/** 受信ごとに新しいオブジェクトを作り、実際の JSON 応答と同じ本文保持を再現する。 */
function client() {
	return {
		async listTurns(_thread, cursor) {
			await yieldLoop();
			const page = Number(cursor ?? 0);
			return JSON.parse(
				JSON.stringify({
					data: Array.from({ length: 4 }, (_, i) => ({
						id: `turn-${page * 4 + i}`,
						status: "completed",
						itemsView: "full",
						items: [
							{
								id: `command-${i}`,
								type: "commandExecution",
								command: "output",
								cwd: ".",
								status: "completed",
								exitCode: 0,
								aggregatedOutput: "日本語🐈".repeat(80000),
							},
						],
					})),
					nextCursor: page < 15 ? String(page + 1) : null,
				}),
			);
		},
		async listItems() {
			throw new Error("Unexpected item request");
		},
	};
}

/** 計測対象の製品コードを独立した Node.js バンドルへまとめる。 */
async function buildApi(repo, root) {
	const source = path
		.join(repo, "apps/vscode-nerita/src/extension")
		.replaceAll("\\", "/");
	await fs.writeFile(
		path.join(root, "entry.ts"),
		`export * from '${source}/backends/codex/history/restoreHistory'; export { ToolOutputStore } from '${source}/session/ToolOutputStore';`,
	);
	await require("esbuild").build({
		entryPoints: [path.join(root, "entry.ts")],
		outfile: path.join(root, "measure.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		conditions: ["nerita-source"],
	});
	return require(path.join(root, "measure.cjs"));
}

/** 全文保持のピークと最終状態を、同じ生成データで測る。 */
async function main() {
	const repo = path.resolve(__dirname, "../..");
	const root = await fs.mkdtemp(path.join(repo, "dist/codex-history-perf-"));
	const api = await buildApi(repo, root);
	global.gc();
	const baseline = process.memoryUsage().heapUsed;
	let peak = baseline;
	let lag = 0;
	let previous = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		lag = Math.max(lag, now - previous - 5);
		previous = now;
		peak = Math.max(peak, process.memoryUsage().heapUsed);
	}, 5);
	const thread = { id: "history", historyMode: "paginated", turns: [] };
	const started = performance.now();
	let state;
	let outputs;
	if (api.restoreDisplayHistory) {
		({ state, outputs } = await api.restoreDisplayHistory(
			client(),
			thread,
			() => true,
		));
	} else {
		const turns = await api.hydrateHistory(client(), thread, () => true);
		peak = Math.max(peak, process.memoryUsage().heapUsed);
		state = api.replayHistory(turns, thread.id);
		outputs = new api.ToolOutputStore();
		state.tools = state.tools.map((tool) => outputs.project(tool));
		await Promise.all(
			state.tools.map((tool) =>
				outputs.read({
					type: "tool/output",
					requestId: "flush",
					outputRef: tool.output.outputRef,
					offset: 0,
					limit: 4,
				}),
			),
		);
	}
	const ms = performance.now() - started;
	clearInterval(timer);
	global.gc();
	const result = {
		label: process.argv[2],
		node: process.version,
		pages: 16,
		outputBytes: 64 * 80000 * 13,
		ms,
		maxTimerLagMs: lag,
		observedPeakHeapGrowthMiB: (peak - baseline) / 1048576,
		retainedHeapGrowthMiB:
			(process.memoryUsage().heapUsed - baseline) / 1048576,
		stateBytes: Buffer.byteLength(JSON.stringify(state)),
	};
	outputs.dispose();
	await fs.writeFile(
		path.join(root, "results.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
	console.log(path.relative(repo, root));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
