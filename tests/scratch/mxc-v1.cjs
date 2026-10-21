// V1 の拒否収集付き spawn のアクセス違反を独立した子プロセスで再現する。
// node tests/scratch/mxc-v1.cjs で実行し、run・収集なし spawn と比較する。
// 分離した SDK を使う場合は --runtime <node_modules を含むディレクトリ> を指定する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const os = require("node:os");
const { packageMxc } = require("../../config/package-mxc.cjs");
const { repoRoot } = require("../../config/workspace-paths.cjs");

async function main() {
	const option = process.argv.indexOf("--runtime");
	if (option !== -1 && !process.argv[option + 1]) {
		throw new Error("--runtime のディレクトリを指定してください。");
	}
	const runtime =
		option === -1
			? path.join(
					repoRoot,
					"dist/mxc-v1-diagnostic/extension/dist/runtime",
				)
			: path.resolve(repoRoot, process.argv[option + 1]);
	if (option === -1) {
		await packageMxc(runtime);
	}
	const sdkRoot = path.join(runtime, "node_modules/@microsoft/mxc-sdk");
	const manifest = JSON.parse(
		await fs.readFile(path.join(sdkRoot, "package.json"), "utf8"),
	);
	const sdk = pathToFileURL(path.join(sdkRoot, "dist/v1/index.js")).href;
	const artifacts = path.join(runtime, "diagnostic");
	await fs.mkdir(artifacts, { recursive: true });
	// SDK が生成する拒否レポートと過去の試験結果を混在させない。
	const root = await fs.mkdtemp(path.join(artifacts, "run-"));
	const environment = {
		sdk: manifest.version,
		node: process.versions.node,
		os: os.release(),
		arch: process.arch,
	};
	console.log(environment);
	const results = [];
	for (const [method, capture] of [
		["spawn", false],
		["run", true],
		["spawn", true],
	]) {
		const summary = executeCase(sdk, root, method, capture);
		results.push(summary);
		console.log(summary);
	}
	await fs.writeFile(
		path.join(root, "result.json"),
		JSON.stringify({ ...environment, results }, null, 2),
	);
	console.log(
		`診断結果: ${path.relative(repoRoot, path.join(root, "result.json"))}`,
	);
}

/** ネイティブのアクセス違反を診断側へ波及させず、1 条件の終了状態を取得する。 */
function executeCase(sdk, root, method, capture) {
	const request = {
		command: "cmd.exe /c echo ready",
		timeoutMs: 10000,
		containment: {
			type: "processcontainer",
			config: capture
				? {
						captureDenials: {
							mode: "block",
							outputPath: path.join(root, "denials.json"),
							retainEtl: false,
						},
					}
				: {},
		},
	};
	const code = `import * as sdk from ${JSON.stringify(sdk)};
console.log('starting');
const request = ${JSON.stringify(request)};
if (${JSON.stringify(method)} === 'run') {
 const result = await sdk.run(request);
 if (result.exitCode !== 0 || result.timedOut) throw new Error('workload failed');
 if (${capture} && !result.outputMetadata?.captureDenials) throw new Error('denial capture missing');
 console.log(JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout, capture: !!result.outputMetadata?.captureDenials }));
} else {
 const child = await sdk.spawn(request);
 try {
  child.standardOutput?.on('data', c => process.stdout.write(c));
  child.standardError?.on('data', c => process.stderr.write(c));
  const result = await child.wait();
  if (result.exitCode !== 0 || result.timedOut) throw new Error('workload failed');
  if (${capture} && !child.outputMetadata?.captureDenials) throw new Error('denial capture missing');
  console.log(JSON.stringify({ ...result, capture: !!child.outputMetadata?.captureDenials }));
 } finally {
  child.dispose();
 }
}`;
	const result = spawnSync(
		process.execPath,
		["--input-type=module", "-e", code],
		{ encoding: "utf8", windowsHide: true, timeout: 30000 },
	);
	const summary = {
		method,
		capture,
		status: result.status,
		signal: result.signal,
		error: result.error?.message,
		stdout: result.stdout,
		stderr: result.stderr,
	};
	return summary;
}

void main();
