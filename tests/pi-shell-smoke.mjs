// 実 SDK のシェル定義と本番サンドボックスで、選択・承認・UTF-8 入出力を検証する。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
	readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.platform, "win32", "Windows実機専用");
const extensionPath = process.cwd();
const out = path.join(extensionPath, "dist/pi-shell-smoke");
await mkdir(out, { recursive: true });
await build({
	stdin: {
		contents: [
			'export { createPiShellTools } from "./src/extension/backends/pi/PiShellTools";',
			'export { createCodexSandboxExecutor, resolveWindowsSandbox } from "./src/extension/backends/codex/CodexSandboxExecutor";',
			'export { createWorkspaceAccessPolicy, WorkspacePathPolicy } from "./src/extension/security/WorkspacePathPolicy";',
		].join("\n"),
		resolveDir: extensionPath,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	outfile: path.join(out, "host.cjs"),
});
const host = createRequire(import.meta.url)(path.join(out, "host.cjs"));
const sdk = await import(
	pathToFileURL(path.join(extensionPath, "dist/runtime/pi.mjs")).href
);
const cwd = await realpath(
	await mkdtemp(path.join(tmpdir(), "nerita-pi-shell-")),
);
const signal = new AbortController().signal;
const executor = host.createCodexSandboxExecutor(extensionPath);
const originalPath = process.env.PATH;
let approvals = 0;
let approve = true;
const calls = [];
const results = [];
const report = {
	date: new Date().toISOString(),
	commit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	cases: [],
};

/** 成功に見せかけず失敗も記録し、独立した後続ケースは続ける。 */
async function test(id, operation) {
	try {
		const details = await operation();
		report.cases.push({ id, status: "pass", details });
		console.log(`PASS ${id}`);
	} catch (error) {
		process.exitCode = 1;
		report.cases.push({ id, status: "fail", error: error.message });
		console.log(`FAIL ${id}: ${error.message}`);
	}
}

try {
	await writeFile(
		path.join(cwd, "native-error.cjs"),
		'process.stderr.write("エラー日本語"); process.exit(7);',
	);
	await writeFile(
		path.join(cwd, "native-pipe.cjs"),
		'process.stdin.setEncoding("utf8"); process.stdin.on("data", s => process.stdout.write(s));',
	);
	// 既存ポータブル版を明示指定した受入でも、本番の探索・サンドボックス起動確認を通す。
	if (process.env.NERITA_SANDBOX_PWSH) {
		const executable = await realpath(process.env.NERITA_SANDBOX_PWSH);
		process.env.PATH = `${path.dirname(executable)}${path.delimiter}${originalPath ?? ""}`;
	}
	const mode = await host.resolveWindowsSandbox(extensionPath, cwd, signal);
	const policy = await host.createWorkspaceAccessPolicy([cwd], mode);
	const tools = await host.createPiShellTools(
		sdk,
		new host.WorkspacePathPolicy(policy, cwd),
		(title, executionSignal) => {
			assert.match(title, /実行範囲: Shell Sandbox/);
			assert.match(title, /Sandbox実装: Codex/);
			approvals++;
			return approve
				? Promise.resolve(executionSignal)
				: Promise.reject(new Error("declined"));
		},
		{
			describe: executor.describe?.bind(executor),
			async execute(permit) {
				calls.push(permit.call);
				const result = await executor.execute(permit);
				results.push(result);
				return result;
			},
		},
		signal,
	);
	report.tools = tools.map((tool) => tool.name);
	if (!report.tools.includes("pwsh")) {
		report.cases.push({
			id: "pwsh",
			status: "unverified",
			reason: "Sandboxで利用可能なpwshがありません",
		});
		process.exitCode = 1;
	}
	assert.equal(approvals, 0, "固定の起動確認だけでモデル入力はまだない");
	if (process.env.NERITA_SANDBOX_PWSH) {
		assert.ok(
			report.tools.includes("pwsh"),
			"明示したpwshがSandboxで利用できない",
		);
	}
	const powershell = tools.find((tool) => tool.name === "powershell");
	assert.ok(powershell);

	/** 実際の `Tool.execute` を通し、承認回数と観測結果を返す。 */
	async function run(tool, command) {
		const before = approvals;
		await tool.execute("shell-smoke", { command, timeout: 15 }, signal);
		assert.equal(approvals, before + 1, "各コマンドに個別承認が必要");
		return results.at(-1);
	}

	for (const tool of tools) {
		await test(`${tool.name}: 短い日本語ファイル出力`, async () => {
			const result = await run(
				tool,
				"Set-Content -LiteralPath '短い日本語.txt' -Encoding utf8 -Value '日本語 $literal'; Get-Content -LiteralPath '短い日本語.txt' -Encoding utf8",
			);
			assert.equal(result.exitCode, 0);
			assert.equal(result.stdout, "日本語 $literal\r\n");
			return result;
		});
		await test(`${tool.name}: 日本語ファイル・stdout・stderr・pipe`, async () => {
			const file = `${tool.name} 日本語.txt`;
			const content = "日本語 $literal '引用'";
			const written = await run(
				tool,
				`Set-Content -LiteralPath '${file}' -Encoding utf8 -Value '日本語 $literal ''引用'''; Get-Content -LiteralPath '${file}' -Encoding utf8`,
			);
			assert.equal(written.exitCode, 0);
			assert.equal(written.stdout, `${content}\r\n`);
			assert.equal(
				(await readFile(path.join(cwd, file), "utf8")).replace(
					/^\uFEFF/,
					"",
				),
				`${content}\r\n`,
			);
			const native = await run(
				tool,
				"node native-error.cjs; exit $LASTEXITCODE",
			);
			assert.equal(native.stderr, "エラー日本語");
			assert.equal(native.exitCode, 7);
			const pipe = await run(tool, "'日本語' | node native-pipe.cjs");
			assert.equal(pipe.exitCode, 0);
			assert.match(pipe.stdout, /^\uFEFF*日本語\r\n$/);
			return { written, native, pipe };
		});
		await test(`${tool.name}: node --version とShellの一致`, async () => {
			const result = await run(tool, "node --version");
			assert.equal(result.exitCode, 0);
			assert.match(result.stdout.trim(), /^v\d+\.\d+\.\d+$/);
			assert.equal(
				path.basename(calls.at(-1).command[0]).toLowerCase(),
				`${tool.name}.exe`,
			);
			const identity = await run(
				tool,
				"Write-Output $PSVersionTable.PSEdition",
			);
			assert.equal(
				identity.stdout.trim(),
				tool.name === "powershell" ? "Desktop" : "Core",
			);
			return {
				version: result.stdout.trim(),
				edition: identity.stdout.trim(),
			};
		});
		await test(`${tool.name}: 拒否でSandbox実行なし`, async () => {
			const before = calls.length;
			approve = false;
			try {
				await assert.rejects(
					tool.execute(
						"decline",
						{ command: "node --version" },
						signal,
					),
					/declined/,
				);
			} finally {
				approve = true;
			}
			assert.equal(calls.length, before);
		});
	}
	await test("powershell: 3つのCodePageが65001、言語制約を維持", async () => {
		const result = await run(
			powershell,
			"Write-Output $OutputEncoding.CodePage; Write-Output ([Console]::InputEncoding.CodePage); Write-Output ([Console]::OutputEncoding.CodePage); Write-Output $ExecutionContext.SessionState.LanguageMode",
		);
		assert.equal(result.exitCode, 0);
		assert.equal(
			result.stdout.trim(),
			"65001\r\n65001\r\n65001\r\nConstrainedLanguage",
		);
		assert.equal(result.stderr, "");
		return result;
	});
	await test("powershell: 短い日本語stdoutとnative UTF-8 stderr・終了コード", async () => {
		const stdout = await run(powershell, "Write-Output '日本語 $literal'");
		assert.equal(stdout.stdout, "日本語 $literal\r\n");
		const native = await run(
			powershell,
			"node native-error.cjs; exit $LASTEXITCODE",
		);
		assert.equal(native.stderr, "エラー日本語");
		assert.equal(native.exitCode, 7);
		return { stdout, native };
	});
	await test("powershell: nativeプログラムへのpipeがUTF-8", async () => {
		const result = await run(powershell, "'日本語' | node native-pipe.cjs");
		assert.equal(result.exitCode, 0);
		// 指定された `Encoding.UTF8` は BOM 付き。文字化けと BOM の有無を混同しない。
		assert.match(result.stdout, /^\uFEFF*日本語\r\n$/);
		return result;
	});
} finally {
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
	await writeFile(
		path.join(out, "results.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	assert.equal(
		path.dirname(cwd),
		await realpath(tmpdir()),
		"不正なfixture削除先",
	);
	assert.ok(
		path.basename(cwd).startsWith("nerita-pi-shell-"),
		"不正なfixture名",
	);
	await rm(cwd, { recursive: true, force: true });
}
