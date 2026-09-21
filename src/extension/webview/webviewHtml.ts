// 拡張機能内の資産だけを許可するCSPと、Webviewの起動HTMLを生成する。
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

/** スクリプトと CSS を拡張機能内だけから読む HTML を生成する。 */
export function webviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	page: "chat" | "pi-auth" = "chat",
): string {
	const nonce = randomBytes(24).toString("base64");
	const script = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.js"),
	);
	const style = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.css"),
	);
	return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${style.toString()}"><title>Codex</title></head>
    <body><div id="root" data-page="${page}"></div><script nonce="${nonce}" src="${script.toString()}"></script></body></html>`;
}
