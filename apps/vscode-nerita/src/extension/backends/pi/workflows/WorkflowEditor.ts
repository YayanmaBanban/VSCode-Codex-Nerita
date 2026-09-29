// TOML を VS Code の文書として編集し、既存セッションのガード付き実行へ接続する。
import * as vscode from "vscode";
import type { BackendSession } from "../../../session/chatSession";
import { webviewHtml } from "../../../webview/webviewHtml";
import { WorkflowPanel } from "./WorkflowPanel";
import { workflowDocument } from "./WorkflowDocument";
import { registerWorkflowCommand } from "./WorkflowEditorCommand";

export const workflowViewType = "nerita.pi.workflow";

/** パネルの停止はそのパネルの実行だけに適用する。 */
class WorkflowEditor implements vscode.CustomTextEditorProvider {
	constructor(
		private context: vscode.ExtensionContext,
		private backend: BackendSession,
	) {}
	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
	) {
		await workflowDocument(document.uri);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, "dist/webview"),
			],
		};
		panel.webview.html = webviewHtml(
			panel.webview,
			this.context.extensionUri,
			"pi-workflow",
		);
		const host = new WorkflowPanel(document, panel, this.backend);
		const listeners = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document === document) {
					host.publish();
				}
			}),
			vscode.workspace.onDidSaveTextDocument((saved) => {
				if (saved === document) {
					host.publish();
				}
			}),
			panel.webview.onDidReceiveMessage((value: unknown) => {
				host.receive(value);
			}),
		];
		panel.onDidDispose(() => {
			host.close();
			listeners.forEach((listener) => {
				listener.dispose();
			});
		});
	}
}

/** 通常のエディタグループと新規作成コマンドを登録する。 */
export function registerWorkflowEditor(
	context: vscode.ExtensionContext,
	backend: BackendSession,
) {
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			workflowViewType,
			new WorkflowEditor(context, backend),
			{ supportsMultipleEditorsPerDocument: false },
		),
	);
	registerWorkflowCommand(context, workflowViewType);
}
