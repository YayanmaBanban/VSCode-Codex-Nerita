// Webview ごとの通信購読をまとめ、表示先の破棄と同時に解放する。
import * as vscode from "vscode";
import type { ChatSession } from "../session/chatSession";

/** `ready` 通知を取りこぼさないよう、HTML の設定より先に購読を完了する。 */
export function bindWebview(
	view: vscode.WebviewView | vscode.WebviewPanel,
	extensionUri: vscode.Uri,
	session: ChatSession,
	receive: (message: unknown) => Promise<void>,
	onDispose: () => void,
): () => void {
	const webview = view.webview;
	webview.options = {
		enableScripts: true,
		localResourceRoots: [
			vscode.Uri.joinPath(extensionUri, "dist", "webview"),
		],
	};

	const unsubscribe = session.subscribe((event) => {
		void webview.postMessage(event);
	});
	const received = webview.onDidReceiveMessage((message: unknown) => {
		void receive(message);
	});
	const disposed = view.onDidDispose(onDispose);

	return () => {
		unsubscribe();
		received.dispose();
		disposed.dispose();
	};
}
