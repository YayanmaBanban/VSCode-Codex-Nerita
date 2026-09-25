// サイドバーの Webview を生成し、通信と購読の寿命を管理する。
import type { ComposerPart } from "../../shared/composerContent";
import * as vscode from "vscode";
import { webviewHtml } from "./webviewHtml";
import { bindWebview } from "./webviewBinding";
import type { ChatSession } from "../session/chatSession";
import type { HostMessage, UiMessage } from "../../shared/messages";
import { isHostMessage } from "../../shared/hostMessageValidation";
import { isRecord } from "../../shared/validation";
import { isUiMessage } from "../../shared/uiMessageValidation";
import { listWorkspacePaths } from "./workspacePaths";
import { resolvePath } from "./resolvePath";
import { CopiedCode } from "./copiedCode";
import { openResource } from "./openResource";
import { searchWorkspaceSymbols } from "./workspaceSymbols";
import { configuredBackend, saveBackend } from "./backendSettings";
import {
	SidebarPlacement,
	saveSidebar,
	sidebarLocation,
} from "./sidebarLocation";
import { type SidebarLocation } from "@/shared/sidebar";

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
	private backendSubscription: vscode.Disposable;
	private backendPending = false;
	private copiedCode = new CopiedCode();
	/** 拡張機能資産と Host の状態サービスを受け取る。 */
	constructor(
		private extensionUri: vscode.Uri,
		private session: ChatSession,
		private restartBackend: () => Promise<void>,
	) {
		this.backendSubscription = vscode.workspace.onDidChangeConfiguration(
			(event) => {
				if (event.affectsConfiguration("nerita.backend")) {
					this.broadcastBackend();
				}
			},
		);
		this.placement = new SidebarPlacement((location) => {
			for (const target of this.views.keys()) {
				void target.postMessage({
					type: "ui/sidebarState",
					location,
				} satisfies HostMessage);
			}
		});
	}
	/** 設定ファイルの変更をすべての表示先へ反映する。 */
	private broadcastBackend(): void {
		for (const webview of this.views.keys()) {
			void webview.postMessage({
				type: "ui/backendState",
				backend: configuredBackend(),
			} satisfies HostMessage);
		}
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
		const dispose = bindWebview(
			view,
			this.extensionUri,
			this.session,
			(message) => this.receive(webview, message),
			() => {
				this.views.get(webview)?.dispose();
				if (editor) {
					this.panel = undefined;
				} else if (this.sidebar === view) {
					this.sidebar = undefined;
				}
			},
		);
		this.views.set(webview, {
			editor,
			dispose: () => {
				dispose();
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
			await this.dispatchViewRequest(webview, value);
		} catch {
			if ("requestId" in value) {
				void webview.postMessage({
					type: "request/failed",
					requestId: value.requestId,
					error: viewRequestError(value.type),
				} satisfies HostMessage);
			}
		}
	}
	/** Webview に属する購読だけを破棄する。 */
	dispose(): void {
		this.copiedCode.dispose();
		this.backendSubscription.dispose();
		this.placement.dispose();
		for (const view of [...this.views.values()]) {
			view.dispose();
		}
		this.panel?.dispose();
		this.panel = undefined;
		this.sidebar = undefined;
	}

	/** 検証済みの参照操作と表示操作を振り分ける。 */
	private async dispatchViewRequest(
		webview: vscode.Webview,
		value: UiMessage,
	): Promise<void> {
		if (value.type === "ui/setBackend") {
			await this.changeBackend(webview, value);
			return;
		}
		if (value.type === "workspace/resolvePath") {
			await webview.postMessage(await resolvePath(value));
			return;
		}
		if (value.type === "workspace/resolveCode") {
			await webview.postMessage({
				type: "workspace/resolvedPath",
				requestId: value.requestId,
				entry: await this.copiedCode.resolve(value.text),
			} satisfies HostMessage);
			return;
		}
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
		await this.dispatchDisplayAction(webview, value);
	}

	/** 実行中の会話を守り、保存と再生成を直列に行う。 */
	private async changeBackend(
		webview: vscode.Webview,
		value: Extract<UiMessage, { type: "ui/setBackend" }>,
	): Promise<void> {
		if (this.backendPending) {
			return;
		}
		if (this.runtimeBusy()) {
			await webview.postMessage({
				type: "request/failed",
				requestId: value.requestId,
				error: "実行・接続処理が終わってからバックエンドを変更してください。",
			} satisfies HostMessage);
			return;
		}
		this.backendPending = true;
		try {
			const changed = await saveBackend(value.backend);
			this.broadcastBackend();
			if (changed) {
				await this.restartBackend();
			}
		} finally {
			this.backendPending = false;
		}
	}

	/** 実行・接続・設定変更の完了前はセッションを交換しない。 */
	private runtimeBusy(): boolean {
		const state = this.session.snapshot();
		return (
			state.run === "running" ||
			state.run === "cancelling" ||
			state.connection === "connecting" ||
			state.connection === "authenticating" ||
			state.sessionPending ||
			state.configPending
		);
	}

	/** 下書きと表示位置を同期して会話操作をバックエンドへ渡す。 */
	private async dispatchDisplayAction(
		webview: vscode.Webview,
		value: UiMessage,
	): Promise<void> {
		if (value.type === "ui/setSidebar") {
			await this.setSidebar(value);
			return;
		}
		if (value.type === "ui/saveDraft") {
			this.saveDraft(value, webview);
			return;
		}
		if (value.type === "ui/saveScroll") {
			this.scrollTop = value.scrollTop;
			return;
		}
		if (value.type === "ui/openEditor") {
			this.openEditor();
			return;
		}
		if (value.type === "ui/openSidebar") {
			await this.openSidebar();
			return;
		}
		if (value.type === "ui/ready") {
			await this.initializeView(webview);
			return;
		}
		await this.session.receive(value);
	}

	/** 指定されたサイドバーへ表示を切り替える。 */
	private async setSidebar(value: {
		type: "ui/setSidebar";
		requestId: string;
		location: SidebarLocation;
	}) {
		await saveSidebar(value.location);
		await this.placement.sync();
		this.sidebar?.show(false);
		if (this.sidebar) {
			this.viewState(this.sidebar.webview);
		}
		this.panel?.dispose();
	}

	/** 要求元のWebviewにだけ接続状態と保存済み表示を復元する。 */
	private async initializeView(webview: vscode.Webview) {
		void webview.postMessage({
			type: "ui/backendState",
			backend: configuredBackend(),
		} satisfies HostMessage);
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
		if (!this.views.get(webview)?.editor && !this.placement.initialized) {
			await this.placement.sync();
		}
	}

	/** サイドバーへ表示と保存済み状態を戻す。 */
	private async openSidebar() {
		await vscode.commands.executeCommand("nerita.codex.chat.focus");
		this.sidebar?.show(false);
		if (this.sidebar) {
			this.viewState(this.sidebar.webview);
		}
		this.panel?.dispose();
	}

	/** エディター内のチャット表示を作成または再表示する。 */
	private openEditor() {
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				"nerita.codex.editor",
				"Nerita for Codex",
				vscode.ViewColumn.Active,
				{ enableScripts: true, retainContextWhenHidden: true },
			);
			this.panel.iconPath = {
				light: vscode.Uri.joinPath(
					this.extensionUri,
					"media",
					"nerita-24.svg",
				),
				dark: vscode.Uri.joinPath(
					this.extensionUri,
					"media",
					"nerita-24.svg",
				),
			};
			this.bind(this.panel, true);
		} else {
			this.panel.reveal(vscode.ViewColumn.Active);
			this.viewState(this.panel.webview);
		}
	}

	/** 下書きの変更を他の表示先へ同期する。 */
	private saveDraft(
		value: {
			type: "ui/saveDraft";
			requestId: string;
			draft: string;
			draftParts?: ComposerPart[];
		},
		webview: vscode.Webview,
	) {
		this.draft = value.draft;
		this.draftParts = value.draftParts;
		for (const target of this.views.keys()) {
			if (target !== webview) {
				this.viewState(target, false);
			}
		}
	}
}

/** 表示操作の失敗に対応した復旧方法を返す。 */
function viewRequestError(type: string) {
	if (type === "ui/setBackend") {
		return "バックエンドの切り替えを完了できませんでした。設定ファイルを確認し、再接続してください。";
	}
	if (type === "reference/open") {
		return "参照先を開けませんでした。ファイルやフォルダの存在を確認してください。";
	}
	return "表示先を切り替えられませんでした。再試行してください。";
}
