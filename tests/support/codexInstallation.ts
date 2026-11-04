// 小さな Windows 実行ファイルと公式形式のアーカイブで、Codex の取得・版判定を隔離する。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { CodexRelease } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/CodexRelease";

const execute = promisify(execFile);
const vendor = "vendor/x86_64-pc-windows-msvc";

/** バージョン照会に応答するテスト用の実行ファイルを作り、シェルや利用者の CLI を使わない。 */
export async function codexInstallation(t: TestContext, version?: string) {
	assert.ok(process.env.NERITA_TEST_ROOT !== undefined);
	assert.ok(process.env.SystemRoot !== undefined);
	const root = await mkdtemp(
		join(process.env.NERITA_TEST_ROOT, "codex-install-"),
	);
	const installed = join(root, "Codex CLI");
	const extension = join(root, "extension");
	await mkdir(installed);
	await mkdir(join(extension, "dist/runtime/codex"), { recursive: true });
	const source = join(root, "Version.cs");
	await writeFile(
		source,
		'using System; using System.IO; class VersionProbe { static void Main(string[] args) { if (args.Length == 1 && args[0] == "--version") Console.WriteLine("codex-cli " + File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "version.txt"))); else File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "started.txt"), "started"); } }',
	);
	const binary = join(root, "probe.exe");
	await execute(
		join(
			process.env.SystemRoot,
			"Microsoft.NET/Framework64/v4.0.30319/csc.exe",
		),
		["/nologo", `/out:${binary}`, source],
		{ windowsHide: true },
	);
	if (version !== undefined) {
		await copyFile(binary, join(installed, "codex.exe"));
		await writeFile(join(installed, "version.txt"), version);
	}
	const ui = bindInstallationEnvironment(t, root, installed);
	const release: CodexRelease = {
		version: "0.164.0",
		experimental: false,
		runtime: {
			url: "https://registry.npmjs.org/@openai/codex/-/codex-0.164.0-win32-x64.tgz",
			integrity: `sha512-${createHash("sha512").update("fixture").digest("base64")}`,
			unpackedSize: 1000000,
		},
	};
	/** 対応版の生成情報を、VSIX と同じ配置へ保存する。 */
	const saveRelease = () =>
		writeFile(
			join(extension, "dist/runtime/codex/version.json"),
			JSON.stringify(release),
		);
	await saveRelease();
	return { root, binary, installed, extension, release, saveRelease, ...ui };
}

/** OS 環境と同意画面だけを代替し、ケース終了時に元へ戻す。 */
function bindInstallationEnvironment(
	t: TestContext,
	root: string,
	installed: string,
) {
	const previousPath = process.env.PATH;
	const previousLocal = process.env.LOCALAPPDATA;
	process.env.PATH = installed;
	process.env.LOCALAPPDATA = join(root, "local");
	t.after(() => {
		if (previousPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = previousPath;
		}
		if (previousLocal === undefined) {
			delete process.env.LOCALAPPDATA;
		} else {
			process.env.LOCALAPPDATA = previousLocal;
		}
		for (const name of [
			"showErrorMessage",
			"showInformationMessage",
			"withProgress",
		]) {
			Reflect.deleteProperty(vscode.window, name);
		}
	});
	let prompts = 0;
	let outdated = 0;
	const consent = { accepted: false };
	Object.assign(vscode.window, {
		showErrorMessage: () => {
			outdated++;
			return Promise.resolve();
		},
		showInformationMessage: () => {
			prompts++;
			return Promise.resolve(
				consent.accepted ? "ダウンロード" : undefined,
			);
		},
		withProgress: (
			_options: unknown,
			run: (
				progress: unknown,
				token: {
					isCancellationRequested: boolean;
					onCancellationRequested: () => { dispose(): void };
				},
			) => Promise<string>,
		) =>
			run(
				{},
				{
					isCancellationRequested: false,
					onCancellationRequested: () => ({ dispose() {} }),
				},
			),
	});
	return {
		consent,
		prompts: () => prompts,
		outdated: () => outdated,
	};
}

/** 音声・Code Mode・Sandbox を含む npm のディレクトリ構造を、Windows 標準の tar コマンドで圧縮する。 */
export async function codexArchive(
	f: Awaited<ReturnType<typeof codexInstallation>>,
) {
	assert.ok(process.env.SystemRoot !== undefined);
	const input = join(f.root, "input");
	const target = join(input, "package", vendor);
	for (const name of ["bin", "codex-path", "codex-resources/voice/bin"]) {
		await mkdir(join(target, name), { recursive: true });
	}
	await copyFile(f.binary, join(target, "bin/codex.exe"));
	await writeFile(join(target, "bin/version.txt"), f.release.version);
	for (const asset of [
		"bin/codex-code-mode-host.exe",
		"codex-path/rg.exe",
		"codex-resources/codex-command-runner.exe",
		"codex-resources/codex-windows-sandbox-setup.exe",
		"codex-resources/voice/bin/codex-voice-host.exe",
	]) {
		await writeFile(join(target, asset), "fixture-asset");
	}
	const archive = join(f.root, "fixture.tgz");
	await execute(
		join(process.env.SystemRoot, "System32/tar.exe"),
		["-czf", archive, "-C", input, "package"],
		{ windowsHide: true },
	);
	const bytes = await readFile(archive);
	f.release.runtime.integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	await f.saveRelease();
	return bytes;
}
