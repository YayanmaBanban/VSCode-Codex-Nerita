// Webviewごとの通信購読をまとめ、表示先の破棄と同時に解放する。
import * as vscode from "vscode";
import type { ChatState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";

/** Webview が必要とする通信だけを公開し、接続プロトコルから独立させる。 */
export type ChatSession = {
	snapshot(): ChatState;
	subscribe(listener: (event: HostMessage) => void): () => void;
	receive(value: unknown): Promise<void>;
};

/** ready通知を取りこぼさないよう、HTMLの設定より先に購読を完了する。 */
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
