// サイドバーの Webview を生成し、通信と購読の寿命を管理する。
import type { ComposerPart } from "../../shared/composerContent";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { ChatState, HostMessage } from "../../shared/messages";
import { isUiMessage } from "../../shared/validation";

/** Webview が必要とする通信だけを公開し、接続プロトコルから独立させる。 */
type ChatSession = {
	snapshot(): ChatState;
	subscribe(listener: (event: HostMessage) => void): () => void;
	receive(value: unknown): Promise<void>;
};

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
    <link rel="stylesheet" href="${style.toString()}"><title>Codex</title></head>
    <body><div id="root"></div><script nonce="${nonce}" src="${script.toString()}"></script></body></html>`;
}
/** UI を閉じても会話を保持し、再表示時の ready で状態を復元する。 */
export class ChatViewProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	private views = new Map<
		vscode.Webview,
		{ editor: boolean; dispose: () => void }
	>();
	private sidebar: vscode.WebviewView | undefined;
	private panel: vscode.WebviewPanel | undefined;
	private draft = "";
	private draftParts: ComposerPart[] | undefined;
	private scrollTop = 0;
	/** 拡張機能資産と Host の状態サービスを受け取る。 */
	constructor(
		private extensionUri: vscode.Uri,
		private session: ChatSession,
	) {}
	/** Webview のロードと検証済みメッセージ通信を接続する。 */
	resolveWebviewView(view: vscode.WebviewView): void {
		this.sidebar = view;
		this.bind(view, false);
	}
	/** 各表示先の購読を独立させ、一方を閉じても接続を維持する。 */
	private bind(
		view: vscode.WebviewView | vscode.WebviewPanel,
		editor: boolean,
	): void {
		const webview = view.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
			],
		};
		const unsubscribe = this.session.subscribe((event) => {
			void webview.postMessage(event);
		});
		const receive = webview.onDidReceiveMessage((message: unknown) => {
			void this.receive(webview, message);
		});
		const disposed = view.onDidDispose(() => {
			this.views.get(webview)?.dispose();
			if (editor) {
				this.panel = undefined;
			} else {
				this.sidebar = undefined;
			}
		});
		this.views.set(webview, {
			editor,
			dispose: () => {
				unsubscribe();
				receive.dispose();
				disposed.dispose();
				this.views.delete(webview);
			},
		});
		webview.html = webviewHtml(webview, this.extensionUri);
	}
	/** 下書きと移動時の位置を、会話の更新番号とは独立して通知する。 */
	private viewState(webview: vscode.Webview, restoreScroll = true): void {
		void webview.postMessage({
			type: "ui/viewState",
			editor: this.views.get(webview)?.editor ?? false,
			draft: this.draft,
			...(this.draftParts ? { draftParts: this.draftParts } : {}),
			scrollTop: this.scrollTop,
			restoreScroll,
		} satisfies HostMessage);
	}
	/** 検証済みの表示操作だけをHostで処理し、会話操作は既存サービスへ渡す。 */
	private async receive(
		webview: vscode.Webview,
		value: unknown,
	): Promise<void> {
		if (!isUiMessage(value)) {
			return;
		}
		try {
			if (value.type === "ui/saveDraft") {
				this.draft = value.draft;
				this.draftParts = value.draftParts;
				for (const target of this.views.keys()) {
					if (target !== webview) {
						this.viewState(target, false);
					}
				}
				return;
			}
			if (value.type === "ui/saveScroll") {
				this.scrollTop = value.scrollTop;
				return;
			}
			if (value.type === "ui/openEditor") {
				if (!this.panel) {
					this.panel = vscode.window.createWebviewPanel(
						"codex-acp.editor",
						"Codex",
						vscode.ViewColumn.Active,
						{ enableScripts: true, retainContextWhenHidden: true },
					);
					this.bind(this.panel, true);
				} else {
					this.panel.reveal(vscode.ViewColumn.Active);
					this.viewState(this.panel.webview);
				}
				return;
			}
			if (value.type === "ui/openSidebar") {
				await vscode.commands.executeCommand("codex-acp.chat.focus");
				this.sidebar?.show(false);
				if (this.sidebar) {
					this.viewState(this.sidebar.webview);
				}
				this.panel?.dispose();
				return;
			}
			if (value.type === "ui/ready") {
				// 復元要求は要求元だけに返し、もう一方のスクロールを動かさない。
				void webview.postMessage({
					type: "state/snapshot",
					state: this.session.snapshot(),
				} satisfies HostMessage);
				this.viewState(webview);
				return;
			}
			await this.session.receive(value);
		} catch {
			if ("requestId" in value) {
				void webview.postMessage({
					type: "request/failed",
					requestId: value.requestId,
					error: "表示先を切り替えられませんでした。再試行してください。",
				} satisfies HostMessage);
			}
		}
	}
	/** Webview に属する購読だけを破棄する。 */
	dispose(): void {
		for (const view of [...this.views.values()]) {
			view.dispose();
		}
		this.panel?.dispose();
		this.panel = undefined;
		this.sidebar = undefined;
	}
}
