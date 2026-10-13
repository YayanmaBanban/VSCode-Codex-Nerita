// DLC の操作画面を独立したエディタに置き、実行の寿命は共通 Host に任せる。
import * as vscode from "vscode";
import { createHash, randomUUID } from "node:crypto";
import { DlcEditorStateSchema } from "@nerita/shared/dlc/contracts";
import type { UiMessage } from "@nerita/shared/messages";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import { errorText } from "@nerita/shared/errorText";
import type { BackendRuntime } from "../session/BackendRuntime";
import { bindWebview } from "../webview/webviewBinding";
import { webviewHtml } from "../webview/webviewHtml";
import { openResource } from "../webview/openResource";
import type { DlcHost } from "./DlcHost";

/** DLC の表示パネルと通信を保持する。利用側は VS Code の破棄処理へ登録し、再表示で実行を生成し直さない。 */
export class DlcWorkspacePanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private unbind: (() => void) | undefined;
	private initialized = false;
	/** Workspace 画面の操作を現在の DLC Host と実行状態へ結び付ける。 */
	constructor(
		private context: vscode.ExtensionContext,
		private host: DlcHost,
		private runtime: BackendRuntime,
	) {}

	/** 単一のエディタを再表示し、開き直しで Run を生成しない。 */
	open(): void {
		if (this.panel) {
			this.panel.reveal();
			this.host.setWorkspaceOpen(true);
			return;
		}
		this.restore(
			vscode.window.createWebviewPanel(
				"nerita.dlc.workspace",
				"DLC Workspace",
				vscode.ViewColumn.Active,
				{ retainContextWhenHidden: true },
			),
		);
	}

	/** VS Code の再読み込みでも、保存済み Intent と表示位置だけを復元する。 */
	restore(panel: vscode.WebviewPanel): void {
		this.dispose();
		this.panel = panel;
		this.initialized = false;
		const workspace =
			vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "none";
		const key = `dlc.editor.${createHash("sha256").update(workspace).digest("hex")}`;
		this.unbind = bindWebview(
			panel,
			this.context.extensionUri,
			this.runtime.scope("dlc"),
			(value) => this.receive(panel, key, value),
			() => {
				this.unbind?.();
				this.unbind = undefined;
				this.panel = undefined;
				this.host.setWorkspaceOpen(false);
			},
		);
		panel.webview.html = webviewHtml(
			panel.webview,
			this.context.extensionUri,
			"dlc-workspace",
		);
		this.host.setWorkspaceOpen(true);
	}

	/** 画面の要求を検証し、失敗は要求元の会話領域へ返す。 */
	private async receive(
		panel: vscode.WebviewPanel,
		key: string,
		value: unknown,
	): Promise<void> {
		if (!isUiMessage(value) || this.panel !== panel) {
			return;
		}
		try {
			await this.dispatch(panel, key, value);
		} catch (error) {
			await panel.webview.postMessage({
				type: "request/failed",
				requestId: "requestId" in value ? value.requestId : "editor",
				error: errorText(error),
			});
		}
	}

	/** DLC 固有の編集状態だけを保存し、通常チャットの下書き・表示位置に DLC の値を混ぜない。 */
	private async dispatch(
		panel: vscode.WebviewPanel,
		key: string,
		value: UiMessage,
	): Promise<void> {
		if (value.type === "ui/ready") {
			await this.initializeView(panel, key);
		} else if (value.type === "dlc/editorState") {
			await this.context.workspaceState.update(key, value.state);
		} else if (value.type === "reference/open") {
			await openResource(value.uri, value.range);
		} else if (value.type === "workspace/manageTrust") {
			await vscode.commands.executeCommand("nerita.trust.manage");
		} else {
			const isChatViewState =
				value.type === "ui/saveScroll" || value.type === "ui/saveDraft";
			if (isChatViewState) {
				// 通常チャットの表示位置・下書きへ DLC の状態を保存しない。
			} else {
				await this.runtime.scope("dlc").receive(value);
			}
		}
	}

	/** 埋め込み会話の ready は状態の再送だけとし、選択済み Controller を読み直さない。 */
	private async initializeView(
		panel: vscode.WebviewPanel,
		key: string,
	): Promise<void> {
		if (!this.initialized) {
			this.initialized = true;
			await this.host.receive({
				type: "dlc/read",
				requestId: randomUUID(),
			});
		}
		const saved = DlcEditorStateSchema.safeParse(
			this.context.workspaceState.get(key),
		);
		await panel.webview.postMessage({
			type: "dlc/editorState",
			state: saved.success ? saved.data : { expanded: {} },
		});
		await panel.webview.postMessage({
			type: "state/snapshot",
			state: this.runtime.scope("dlc").snapshot(),
		});
	}

	/** 購読とパネルを一度だけ回収し、Workspace の表示が閉じたことを Host へ伝える。 */
	dispose(): void {
		this.unbind?.();
		this.unbind = undefined;
		const panel = this.panel;
		this.panel = undefined;
		panel?.dispose();
		if (panel) {
			this.host.setWorkspaceOpen(false);
		}
	}
}
