// 一時計測は `node tests/scratch/codex-json-worker-performance.cjs` で実行する。
// 同じ巨大 JSONL を従来の `readline` と `JSON.parse`、製品の Worker でそれぞれ読み、受け渡しを含めて計測する。
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

/** 独立プロセスで同じ入力を読み、Host の停止時間とヒープだけを測る。 */
async function measure(mode, root) {
	global.gc();
	const baseline = process.memoryUsage().heapUsed;
	let maxLag = 0;
	let previous = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		maxLag = Math.max(maxLag, now - previous - 5);
		previous = now;
	}, 5);
	const started = performance.now();
	let length = 0;
	const input = fs.createReadStream(path.join(root, "input.jsonl"));
	let reader;
	await new Promise((resolve, reject) => {
		const receive = (value) => {
			length += value.output.length;
		};
		input.on("error", reject);
		if (mode === "worker") {
			const { AppServerJsonReader } = require(
				path.join(root, "reader.cjs"),
			);
			reader = new AppServerJsonReader(input, receive, resolve);
		} else {
			const lines = require("node:readline").createInterface({ input });
			lines.on("line", (line) => receive(JSON.parse(line)));
			lines.on("close", resolve);
		}
	});
	const ms = performance.now() - started;
	await new Promise((resolve) => setTimeout(resolve, 10));
	clearInterval(timer);
	await reader?.dispose();
	if (length !== 20000000) {
		throw new Error("Output mismatch");
	}
	console.log(
		JSON.stringify({
			mode,
			ms,
			maxLagMs: maxLag,
			hostHeapGrowthMiB:
				(process.memoryUsage().heapUsed - baseline) / 1048576,
		}),
	);
}

/** 圧縮した製品コードを使い、関数の Worker 化が本番ビルドでも成立することを確認する。 */
async function main() {
	const repo = path.resolve(__dirname, "../..");
	const root = fs.mkdtempSync(path.join(repo, "dist/codex-json-worker-"));
	fs.writeFileSync(
		path.join(root, "input.jsonl"),
		`${JSON.stringify({ output: "日本語🐈".repeat(4000000) })}\n`,
	);
	await require("esbuild").build({
		entryPoints: [
			path.join(
				repo,
				"apps/vscode-nerita/src/extension/backends/codex/runtime/AppServerJsonReader.ts",
			),
		],
		outfile: path.join(root, "reader.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		minify: true,
		conditions: ["nerita-source"],
	});
	const results = [];
	for (const mode of ["baseline", "worker"]) {
		const child = spawnSync(
			process.execPath,
			["--expose-gc", __filename, mode, root],
			{ encoding: "utf8", windowsHide: true },
		);
		if (child.status !== 0) {
			throw new Error(child.stderr || child.stdout);
		}
		results.push(JSON.parse(child.stdout));
	}
	fs.writeFileSync(
		path.join(root, "results.json"),
		JSON.stringify(results, null, 2),
	);
	console.log(JSON.stringify(results));
	console.log(path.relative(repo, root));
}

(process.argv[2] ? measure(process.argv[2], process.argv[3]) : main()).catch(
	(error) => {
		console.error(error);
		process.exitCode = 1;
	},
);
