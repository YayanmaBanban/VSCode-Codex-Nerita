// サイドバーの Webview を生成し、通信と購読の寿命を管理する。
import type { ComposerPart } from "../../shared/composerContent";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { ChatState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";
import { isHostMessage } from "../../shared/hostMessageValidation";
import { isRecord } from "../../shared/validation";
import { isUiMessage } from "../../shared/uiMessageValidation";
import { listWorkspacePaths } from "./workspacePaths";
import { openResource } from "./openResource";
import { searchWorkspaceSymbols } from "./workspaceSymbols";
import {
	SidebarPlacement,
	saveSidebar,
	sidebarLocation,
} from "./sidebarLocation";

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
	private placement: SidebarPlacement;
	/** 拡張機能資産と Host の状態サービスを受け取る。 */
	constructor(
		private extensionUri: vscode.Uri,
		private session: ChatSession,
	) {
		this.placement = new SidebarPlacement((location) => {
			for (const target of this.views.keys()) {
				void target.postMessage({
					type: "ui/sidebarState",
					location,
				} satisfies HostMessage);
			}
		});
	}
	/** Webview のロードと検証済みメッセージ通信を接続する。 */
	resolveWebviewView(view: vscode.WebviewView): void {
		this.sidebar = view;
		this.bind(view, false);
	}
	/** メニューを開いた入力欄だけが照合できる識別子で変換を通知する。 */
	convertSelectionToCodeBlock(context: unknown): void {
		if (!isRecord(context)) {
			return;
		}
		const message = {
			type: "ui/codeBlock",
			requestId: context.composerSelectionId,
		};
		if (!isHostMessage(message)) {
			return;
		}
		for (const webview of this.views.keys()) {
			void webview.postMessage(message);
		}
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
			} else if (this.sidebar === view) {
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
			if (value.type === "reference/open") {
				await openResource(value.uri, value.range);
				return;
			}
			if (value.type === "workspace/listPaths") {
				await webview.postMessage(await listWorkspacePaths(value));
				return;
			}
			if (value.type === "workspace/searchSymbols") {
				await webview.postMessage(await searchWorkspaceSymbols(value));
				return;
			}
			if (value.type === "ui/setSidebar") {
				await saveSidebar(value.location);
				await this.placement.sync();
				this.sidebar?.show(false);
				if (this.sidebar) {
					this.viewState(this.sidebar.webview);
				}
				this.panel?.dispose();
				return;
			}
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
				void webview.postMessage({
					type: "ui/sidebarState",
					location: sidebarLocation(),
				} satisfies HostMessage);
				// 復元要求は要求元だけに返し、もう一方のスクロールを動かさない。
				void webview.postMessage({
					type: "state/snapshot",
					state: this.session.snapshot(),
				} satisfies HostMessage);
				this.viewState(webview);
				// 保存した配置は最初のサイドバー表示時に復元する。
				if (
					!this.views.get(webview)?.editor &&
					!this.placement.initialized
				) {
					await this.placement.sync();
				}
				return;
			}
			await this.session.receive(value);
		} catch {
			if ("requestId" in value) {
				void webview.postMessage({
					type: "request/failed",
					requestId: value.requestId,
					error:
						value.type === "reference/open"
							? "参照先を開けませんでした。ファイルやフォルダの存在を確認してください。"
							: "表示先を切り替えられませんでした。再試行してください。",
				} satisfies HostMessage);
			}
		}
	}
	/** Webview に属する購読だけを破棄する。 */
	dispose(): void {
		this.placement.dispose();
		for (const view of [...this.views.values()]) {
			view.dispose();
		}
		this.panel?.dispose();
		this.panel = undefined;
		this.sidebar = undefined;
	}
}
