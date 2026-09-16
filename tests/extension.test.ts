// 実際の Extension Host で拡張機能の起動・コマンド・UI 資産を確認する。
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { access, readdir, readFile } from "node:fs/promises";
import { CodexClient } from "../src/extension/codex/CodexClient";

suite("Codex ACP Extension", () => {
	test("同梱 App Server を Extension Host から初期化して終了する", async () => {
		const extension = vscode.extensions.getExtension(
			"codex-acp-local.codex-acp",
		);
		assert.ok(extension);
		const client = await CodexClient.connect({
			extensionPath: extension.extensionUri.fsPath,
			cwd: extension.extensionUri.fsPath,
			clientInfo: {
				name: "vscode_codex",
				title: "VS Code Codex",
				version: "0.0.1",
			},
		});
		try {
			assert.equal(client.serverInfo.platformOs, "windows");
			assert.deepEqual(await client.listLoadedThreads(), {
				data: [],
				nextCursor: null,
			});
		} finally {
			await client.dispose();
		}
	});
	test("チャット用コマンドを登録し、Webview の資産を同梱する", async () => {
		const extension = vscode.extensions.getExtension(
			"codex-acp-local.codex-acp",
		);
		assert.ok(extension);
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("codex-acp.openChat"));
		assert.ok(commands.includes("codex-acp.newSession"));
		for (const asset of [
			"dist/webview/index.js",
			"dist/webview/index.css",
			"dist/runtime/node_modules/@openai/codex/LICENSE",
			"dist/runtime/node_modules/@openai/codex/NOTICE",
			"dist/runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
		]) {
			await access(
				vscode.Uri.joinPath(extension.extensionUri, asset).fsPath,
			);
		}
		await vscode.commands.executeCommand("codex-acp.openChat");
	});
	test("配布runtimeにApp Server用のCodexだけが含まれる", async () => {
		const extension = vscode.extensions.getExtension(
			"codex-acp-local.codex-acp",
		);
		assert.ok(extension);
		const runtime = vscode.Uri.joinPath(
			extension.extensionUri,
			"dist/runtime",
		);
		assert.deepEqual(await readdir(runtime.fsPath), ["node_modules"]);
		assert.deepEqual(
			(
				await readdir(
					vscode.Uri.joinPath(runtime, "node_modules/@openai").fsPath,
				)
			).sort(),
			["codex", "codex-win32-x64"],
		);
		const manifest = JSON.parse(
			await readFile(
				vscode.Uri.joinPath(extension.extensionUri, "package.json")
					.fsPath,
				"utf8",
			),
		) as { dependencies: Record<string, string> };
		assert.ok(
			!Object.keys(manifest.dependencies).some((name) =>
				name.startsWith("@agentclientprotocol/"),
			),
		);
	});
});
