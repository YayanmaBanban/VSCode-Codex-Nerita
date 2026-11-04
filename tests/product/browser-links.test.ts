// 外部リンクの通信境界と、VS Code の標準メニューからの起動・拒否を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import * as vscode from "vscode";
import { isBrowserUrl } from "@nerita/shared/browserLinks";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import {
	openBrowserLink,
	registerBrowserLinkCommand,
} from "../../apps/vscode-nerita/src/extension/webview/browserLinks";

void test("外部起動の要求は絶対 HTTP/HTTPS だけを許可し、危険なスキームと難読化を拒否する", () => {
	for (const url of [
		"https://example.com/docs?q=test#section",
		"HTTP://localhost:3000/",
		"https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E",
	]) {
		assert.ok(isBrowserUrl(url), url);
		assert.ok(
			isUiMessage({ type: "link/openExternal", requestId: "open", url }),
		);
	}
	for (const url of [
		undefined,
		42,
		"",
		"https://",
		"/relative",
		"//example.com",
		"file:///sample.md",
		"command:workbench.action.closeWindow",
		"javascript:alert(1)",
		"data:text/html,test",
		"mailto:user@example.com",
		"https:\\example.com",
		"https://example.com\n/path",
		"https://example.com/\u007f",
		" https://example.com",
	]) {
		assert.equal(isBrowserUrl(url), false, String(url));
		assert.equal(
			isUiMessage({ type: "link/openExternal", requestId: "open", url }),
			false,
			String(url),
		);
	}
});

void test("メニューと修飾クリックは既定ブラウザーへ渡し、不正な引数や起動失敗を成功にしない", async () => {
	const opened: string[] = [];
	const errors: string[] = [];
	let available = true;
	Object.assign(vscode.Uri, {
		parse: (value: string) => ({ toString: () => value }),
	});
	Object.assign(vscode.env, {
		openExternal: (uri: vscode.Uri) => {
			opened.push(uri.toString());
			return Promise.resolve(available);
		},
	});
	let command!: (context: unknown) => Promise<void>;
	Object.assign(vscode.commands, {
		registerCommand: (_id: string, callback: typeof command) => {
			command = callback;
			return { dispose() {} };
		},
	});
	Object.assign(vscode.window, {
		showErrorMessage: (message: string) => {
			errors.push(message);
			return Promise.resolve(undefined);
		},
	});
	registerBrowserLinkCommand({ subscriptions: [] });
	await command({ neritaLinkUrl: "https://example.com/menu" });
	await openBrowserLink("https://example.com/ctrl");
	assert.deepEqual(opened, [
		"https://example.com/menu",
		"https://example.com/ctrl",
	]);

	await command({ neritaLinkUrl: "command:workbench.action.closeWindow" });
	await command(undefined);
	await assert.rejects(openBrowserLink("file:///sample.md"));
	assert.equal(opened.length, 2, "拒否した URL を OS へ渡さない");
	assert.equal(errors.length, 2);

	available = false;
	await assert.rejects(openBrowserLink("https://example.com/unavailable"));
	await command({ neritaLinkUrl: "https://example.com/unavailable" });
	assert.equal(errors.length, 3, "メニューからの起動失敗を通知する");
});
