// Webview ごとの通信購読をまとめ、表示先の破棄と同時に解放する。
import * as vscode from "vscode";
import type { ChatSession } from "../session/chatSession";

/** 購読の登録後に CSP 付きの HTML を設定してから、スクリプト実行を有効にする。 */
export function bindWebview(
	view: vscode.WebviewView | vscode.WebviewPanel,
	extensionUri: vscode.Uri,
	session: ChatSession,
	receive: (message: unknown) => Promise<void>,
	onDispose: () => void,
	html: string,
): () => void {
	const webview = view.webview;
	const unsubscribe = session.subscribe((event) => {
		void webview.postMessage(event);
	});
	const received = webview.onDidReceiveMessage((message: unknown) => {
		void receive(message);
	});
	const disposed = view.onDidDispose(onDispose);
	// `options` の変更でも VS Code は現在の HTML を再読み込みするため、空の HTML を先に送らない。
	webview.html = html;
	webview.options = {
		enableScripts: true,
		localResourceRoots: [
			vscode.Uri.joinPath(extensionUri, "dist", "webview"),
		],
	};

	return () => {
		unsubscribe();
		received.dispose();
		disposed.dispose();
	};
}
