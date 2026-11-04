// `node tests/scratch/workspace-symbol-probe.cjs` で専用 VS Code の言語プロバイダーと製品検索を比較する。
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { build } = require("esbuild");
const { runTests } = require("@vscode/test-electron");

/** 利用者のプロファイルを変更せず、未表示の TypeScript ファイルの検索を検証する。 */
async function main() {
	const root = path.resolve("dist/ui-review", `symbol-probe-${Date.now()}`);

	const workspace = process.argv.includes("--repository")
		? path.resolve(".")
		: path.join(root, "workspace");
	const extension = path.join(root, "extension");
	await fs.mkdir(workspace, { recursive: true });
	await fs.mkdir(extension, { recursive: true });
	await fs.writeFile(
		path.join(extension, "package.json"),
		JSON.stringify({
			name: "symbol-probe",
			publisher: "local",
			version: "0.0.1",
			engines: { vscode: "^1.137.0" },
		}),
	);
	if (!process.argv.includes("--repository")) {
		await fs.writeFile(
			path.join(workspace, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { target: "ES2022" },
				include: ["*.ts"],
			}),
		);
		await fs.writeFile(
			path.join(workspace, "example.ts"),
			"export class WorkspaceSymbolProbe { run() { return 1; } }\n",
		);
	}
	await build({
		entryPoints: ["tests/scratch/workspace-symbol-probe.ts"],
		outfile: path.join(root, "probe.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		external: ["vscode"],
		conditions: ["nerita-source"],
	});
	await runTests({
		vscodeExecutablePath: path.resolve(
			".vscode-test/vscode-win32-x64-archive-1.143.1/Code.exe",
		),
		extensionDevelopmentPath: extension,
		extensionTestsPath: path.join(root, "probe.cjs"),
		launchArgs: [
			workspace,
			"--user-data-dir",
			path.join(root, "profile"),
			"--extensions-dir",
			path.join(root, "extensions"),
			"--skip-welcome",
			"--skip-release-notes",
			"--disable-workspace-trust",
		],
		extensionTestsEnv: {
			NERITA_SYMBOL_REPORT: path.join(root, "report.json"),
			NERITA_SYMBOL_REPOSITORY: String(
				process.argv.includes("--repository"),
			),
		},
	});
	console.log(await fs.readFile(path.join(root, "report.json"), "utf8"));
	console.log(root);
}

test("VS Code: ワークスペースシンボルを検索する", main);
