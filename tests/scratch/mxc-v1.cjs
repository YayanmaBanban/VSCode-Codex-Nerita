// V1 の拒否収集付き spawn のアクセス違反を独立した子プロセスで再現する。
// node tests/scratch/mxc-v1.cjs で実行し、run・収集なし spawn と比較する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { packageMxc } = require("../../config/package-mxc.cjs");
const { repoRoot } = require("../../config/workspace-paths.cjs");

async function main() {
	const root = path.join(repoRoot, "dist/mxc-v1-diagnostic");
	const extension = path.join(root, "extension");
	await packageMxc(path.join(extension, "dist/runtime"));
	const sdk = pathToFileURL(path.join(extension, "dist/runtime/node_modules/@microsoft/mxc-sdk/dist/v1/index.js")).href;
	const results = [];
	for (const [method, capture] of [["spawn", false], ["run", true], ["spawn", true]]) {
		const request = {
			command: "cmd.exe /c echo ready", timeoutMs: 10000,
			containment: { type: "processcontainer", config: capture ? { captureDenials: { mode: "block", outputPath: path.join(root, "denials.json"), retainEtl: false } } : {} },
		};
		const code = `import * as sdk from ${JSON.stringify(sdk)};
console.log('starting');
const request = ${JSON.stringify(request)};
if (${JSON.stringify(method)} === 'run') {
 const result = await sdk.run(request);
 console.log(JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout, capture: !!result.outputMetadata?.captureDenials }));
} else {
 const child = await sdk.spawn(request);
 child.standardOutput?.on('data', c => process.stdout.write(c));
 child.standardError?.on('data', c => process.stderr.write(c));
 console.log(JSON.stringify(await child.wait()));
 child.dispose();
}`;
		const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", windowsHide: true, timeout: 30000 });
		const summary = { method, capture, status: result.status, stdout: result.stdout, stderr: result.stderr };
		results.push(summary);
		console.log(summary);
	}
	await fs.writeFile(path.join(root, "result.json"), JSON.stringify({ node: process.versions.node, results }, null, 2));
}

void main();
