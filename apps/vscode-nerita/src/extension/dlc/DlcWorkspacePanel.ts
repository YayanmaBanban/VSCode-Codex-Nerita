// DLC の操作画面を独立したエディタに置き、実行の寿命は共通 Host に任せる。
import * as vscode from "vscode";
import { createHash, randomUUID } from "node:crypto";
import { DlcEditorStateSchema } from "@nerita/shared/dlc/contracts";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import { errorText } from "@nerita/shared/errorText";
import type { BackendRuntime } from "../session/BackendRuntime";
import { bindWebview } from "../webview/webviewBinding";
import { webviewHtml } from "../webview/webviewHtml";
import type { DlcHost } from "./DlcHost";

export class DlcWorkspacePanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private unbind: (() => void) | undefined;
	constructor(
		private context: vscode.ExtensionContext,
		private host: DlcHost,
		private runtime: BackendRuntime,
	) {}

	/** 単一のエディタを再表示し、開き直しで Run を生成しない。 */
	async open(): Promise<void> {
		await this.host.receive({
			type: "ui/setMode",
			requestId: randomUUID(),
			mode: "dlc",
		});
		if (this.panel) {
			this.panel.reveal();
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
		const workspace =
			vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "none";
		const key = `dlc.editor.${createHash("sha256").update(workspace).digest("hex")}`;
		this.unbind = bindWebview(
			panel,
			this.context.extensionUri,
			this.runtime,
			async (value) => {
				if (!isUiMessage(value) || this.panel !== panel) {
					return;
				}
				try {
					if (value.type === "ui/ready") {
						const saved = DlcEditorStateSchema.safeParse(
							this.context.workspaceState.get(key),
						);
						await panel.webview.postMessage({
							type: "dlc/editorState",
							state: saved.success
								? saved.data
								: { expanded: {} },
						});
						await this.host.receive({
							type: "ui/setMode",
							requestId: randomUUID(),
							mode: "dlc",
						});
					} else if (value.type === "dlc/editorState") {
						await this.context.workspaceState.update(
							key,
							value.state,
						);
					} else if (value.type.startsWith("dlc/")) {
						await this.runtime.receive(value);
					}
				} catch (error) {
					await panel.webview.postMessage({
						type: "request/failed",
						requestId:
							"requestId" in value ? value.requestId : "editor",
						error: errorText(error),
					});
				}
			},
			() => {
				this.unbind?.();
				this.unbind = undefined;
				this.panel = undefined;
			},
		);
		panel.webview.html = webviewHtml(
			panel.webview,
			this.context.extensionUri,
			"dlc-workspace",
		);
	}

	dispose(): void {
		this.unbind?.();
		this.unbind = undefined;
		const panel = this.panel;
		this.panel = undefined;
		panel?.dispose();
	}
}
