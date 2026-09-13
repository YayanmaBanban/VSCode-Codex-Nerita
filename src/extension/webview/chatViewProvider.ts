// サイドバーの Webview を生成し、通信と購読の寿命を管理する。
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { SessionController } from "../session/sessionController";

/** スクリプトと CSS を拡張機能内だけから読む HTML を生成する。 */
export function webviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
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
    <link rel="stylesheet" href="${style.toString()}"><title>Codex ACP</title></head>
    <body><div id="root"></div><script nonce="${nonce}" src="${script.toString()}"></script></body></html>`;
}
/** UI を閉じても会話を保持し、再表示時の ready で状態を復元する。 */
export class ChatViewProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	private subscriptions: vscode.Disposable[] = [];
	/** 拡張機能資産と Host の状態サービスを受け取る。 */
	constructor(
		private extensionUri: vscode.Uri,
		private session: SessionController,
	) {}
	/** Webview のロードと検証済みメッセージ通信を接続する。 */
	resolveWebviewView(view: vscode.WebviewView): void {
		this.dispose();
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
			],
		};
		const unsubscribe = this.session.subscribe((event) => {
			void view.webview.postMessage(event);
		});
		this.subscriptions.push(
			{ dispose: unsubscribe },
			view.webview.onDidReceiveMessage((message: unknown) => {
				void this.session.receive(message);
			}),
			view.onDidDispose(() => this.dispose()),
		);
		view.webview.html = webviewHtml(view.webview, this.extensionUri);
	}
	/** Webview に属する購読だけを破棄する。 */
	dispose(): void {
		const subscriptions = this.subscriptions.splice(0);
		subscriptions.forEach((s) => {
			s.dispose();
		});
	}
}
