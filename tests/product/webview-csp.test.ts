// VS Code の `options` 更新による HTML の再送を模倣し、初回表示から CSP が設定され、`ready` 通知を受信できることを確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import * as vscode from "vscode";
import { initialState } from "@nerita/shared/chatState";
import { bindWebview } from "../../apps/vscode-nerita/src/extension/webview/webviewBinding";
import { webviewHtml } from "../../apps/vscode-nerita/src/extension/webview/webviewHtml";

/** VS Code が `options` の設定時に現在の HTML を送信する処理を代替する。 */
function boundary(page: "chat" | "dlc-workspace") {
	Object.assign(vscode.Uri, {
		file: (fsPath: string) => ({ fsPath }),
		joinPath: (_base: vscode.Uri, ...parts: string[]) => ({
			toString: () => parts.join("/"),
		}),
	});
	const messages: unknown[] = [];
	const rendered: string[] = [];
	let receive: (message: unknown) => void = () => {
		throw new Error("ready の購読がありません。");
	};
	let html = "";
	let unsubscribe = false;
	let receivedDisposed = false;
	let viewDisposed = false;
	const webview = {
		cspSource: "https://fixture.vscode-cdn.net",
		asWebviewUri: (uri: vscode.Uri) => uri,
		postMessage: () => Promise.resolve(true),
		onDidReceiveMessage: (listener: typeof receive) => {
			receive = listener;
			return {
				dispose: () => {
					receivedDisposed = true;
				},
			};
		},
		get html() {
			return html;
		},
		set html(value: string) {
			html = value;
			rendered.push(html);
			receive({ type: "ui/ready" });
		},
		set options(_value: vscode.WebviewOptions) {
			rendered.push(html);
		},
	};
	Object.assign(vscode.window, {
		createWebviewPanel: () => ({
			webview,
			onDidDispose: () => ({
				dispose: () => {
					viewDisposed = true;
				},
			}),
		}),
	});
	const view = vscode.window.createWebviewPanel(
		page,
		page,
		vscode.ViewColumn.Active,
	);
	const extensionUri = vscode.Uri.file("fixture");
	const session = {
		snapshot: () => initialState(),
		receive: async () => {},
		subscribe: () => () => {
			unsubscribe = true;
		},
	};
	return {
		view,
		extensionUri,
		session,
		messages,
		rendered,
		disposed: () => unsubscribe && receivedDisposed && viewDisposed,
	};
}

for (const page of ["chat", "dlc-workspace"] as const) {
	void test(`${page} はオプション変更で送られる HTML にも CSP があり、初回 ready を受け取れる`, () => {
		const { view, extensionUri, session, messages, rendered, disposed } =
			boundary(page);
		const dispose = bindWebview(
			view,
			extensionUri,
			session,
			(message) => {
				messages.push(message);
				return Promise.resolve();
			},
			() => {},
			webviewHtml(view.webview, extensionUri, page),
		);
		assert.equal(rendered.length, 2);
		for (const document of rendered) {
			assert.match(
				document,
				/<meta http-equiv="Content-Security-Policy"/,
			);
			assert.match(document, /default-src 'none'/);
			assert.match(document, /script-src 'nonce-[^']+'/);
			assert.ok(document.includes(`data-page="${page}"`));
		}
		assert.deepEqual(messages, [{ type: "ui/ready" }]);
		dispose();
		assert.equal(disposed(), true);
	});
}
