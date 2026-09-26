// 実際の Extension Host で拡張機能の起動・コマンド・UI 資産を確認する。
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { access, readdir, readFile } from "node:fs/promises";
import { CodexClient } from "../src/extension/backends/codex/CodexClient";
import { piExtensionSmoke } from "./piExtensionSmoke";
import { piGuardrailsSmoke } from "./piGuardrailsSmoke";
import { piTrustSmoke } from "./piTrustSmoke";
import { piSubagentAdapterSmoke } from "./piSubagentAdapterSmoke";
import { piWorkflowSmoke } from "./piWorkflowSmoke";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPiAuthService } from "../src/extension/backends/pi/PiAuthService";
import {
	moveSidebar,
	saveSidebar,
} from "../src/extension/webview/sidebarLocation";

suite("Nerita for Codex Extension", () => {
	test("未信頼の実SDKでは読取りだけを許可し、Trust後も書込みを承認する", async function () {
		this.timeout(60000);
		await piTrustSmoke(
			vscode.extensions.getExtension("nerita-local.nerita-codex")!
				.extensionUri.fsPath,
		);
	});
	test("TOML Workflowが子の継続とForkをガード付きで実行する", async function () {
		this.timeout(60000);
		const root =
			process.env.NERITA_SUBAGENTS_PACKAGE ??
			join(homedir(), ".pi/agent/npm/node_modules/pi-subagents");
		try {
			await access(join(root, "package.json"));
		} catch {
			this.skip();
			return;
		}
		await piWorkflowSmoke(
			vscode.extensions.getExtension("nerita-local.nerita-codex")!
				.extensionUri.fsPath,
			root,
		);
	});
	test("subagentアダプターが子の書込みを別途承認し、結果を親へ返す", async function () {
		this.timeout(60000);
		await piSubagentAdapterSmoke(
			vscode.extensions.getExtension("nerita-local.nerita-codex")!
				.extensionUri.fsPath,
		);
	});
	test("子と孫の実SDK Tool Callがガード・承認・親の取消しに従う", async function () {
		this.timeout(60000);
		const extension = vscode.extensions.getExtension(
			"nerita-local.nerita-codex",
		)!;
		await piGuardrailsSmoke(extension.extensionUri.fsPath);
	});
	test("Pi認証管理をエディターグループに開き、取消で閉じる", async () => {
		const extension = vscode.extensions.getExtension(
			"nerita-local.nerita-codex",
		)!;
		const abort = new AbortController();
		const service = createPiAuthService(extension.extensionUri);
		const done = service.manage(
			() => Promise.resolve([]),
			() => Promise.resolve(),
			abort.signal,
		);
		try {
			const deadline = Date.now() + 5000;
			while (
				!vscode.window.tabGroups.all.some((group) =>
					group.tabs.some((tab) => tab.label === "Pi 認証情報"),
				)
			) {
				assert.ok(
					Date.now() < deadline,
					"認証エディターが開かれていません",
				);
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			const tab = vscode.window.tabGroups.all
				.flatMap((group) => group.tabs)
				.find((tab) => tab.label === "Pi 認証情報")!;
			assert.ok(tab.input instanceof vscode.TabInputWebview);
		} finally {
			abort.abort();
			await done;
		}
	});
	test("同梱Pi SDKで本文・ツール結果を受信し、Extension Hostから停止する", async () => {
		const extension = vscode.extensions.getExtension(
			"nerita-local.nerita-codex",
		);
		assert.ok(extension);
		await piExtensionSmoke(extension.extensionUri.fsPath);
	});
	test("サイドバーの両コンテナへ移動しユーザー設定を保存する", async () => {
		await vscode.extensions
			.getExtension("nerita-local.nerita-codex")!
			.activate();
		const config = vscode.workspace.getConfiguration("nerita.codex");
		const previous = config.inspect<string>("sidebarLocation")?.globalValue;
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("vscode.moveViews"));
		for (const id of ["nerita-primary", "nerita"]) {
			assert.ok(
				commands.includes(
					`workbench.view.extension.${id}.resetViewContainerLocation`,
				),
			);
		}
		try {
			for (const location of ["primary", "secondary"] as const) {
				await saveSidebar(location);
				assert.equal(
					vscode.workspace
						.getConfiguration("nerita.codex")
						.inspect("sidebarLocation")?.globalValue,
					location,
				);
				await moveSidebar(location);
			}
		} finally {
			await config.update(
				"sidebarLocation",
				previous,
				vscode.ConfigurationTarget.Global,
			);
		}
	});
	test("同梱 App Server を Extension Host から初期化して終了する", async () => {
		const extension = vscode.extensions.getExtension(
			"nerita-local.nerita-codex",
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
			"nerita-local.nerita-codex",
		);
		assert.ok(extension);
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("nerita.codex.openChat"));
		assert.ok(commands.includes("nerita.codex.newSession"));
		assert.ok(commands.includes("nerita.trust.manage"));
		assert.ok(commands.includes("nerita.trust.revoke"));
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
		await vscode.commands.executeCommand("nerita.codex.openChat");
	});
	test("配布runtimeにCodexとPiの実行資産が含まれる", async () => {
		const extension = vscode.extensions.getExtension(
			"nerita-local.nerita-codex",
		);
		assert.ok(extension);
		const runtime = vscode.Uri.joinPath(
			extension.extensionUri,
			"dist/runtime",
		);
		assert.deepEqual((await readdir(runtime.fsPath)).sort(), [
			"node_modules",
			"pi",
			"pi.mjs",
		]);
		await access(vscode.Uri.joinPath(runtime, "pi.mjs").fsPath);
		await access(vscode.Uri.joinPath(runtime, "pi/core.mjs").fsPath);
		await access(
			vscode.Uri.joinPath(runtime, "pi/image-resize-worker.mjs").fsPath,
		);
		await access(
			vscode.Uri.joinPath(
				runtime,
				"node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm",
			).fsPath,
		);
		await assert.rejects(
			access(
				vscode.Uri.joinPath(
					runtime,
					"node_modules/@earendil-works/pi-coding-agent",
				).fsPath,
			),
			{ code: "ENOENT" },
		);
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
