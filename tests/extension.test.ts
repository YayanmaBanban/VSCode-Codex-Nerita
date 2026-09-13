// 実際の Extension Host で拡張機能の起動・コマンド・UI 資産を確認する。
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { access } from "node:fs/promises";

suite("Codex ACP Extension", () => {
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
			"dist/runtime/adapter.mjs",
		]) {
			await access(
				vscode.Uri.joinPath(extension.extensionUri, asset).fsPath,
			);
		}
		await vscode.commands.executeCommand("codex-acp.openChat");
	});
});
