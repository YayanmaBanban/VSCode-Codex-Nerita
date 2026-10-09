// コマンドは Webview と共通の Intent 操作へ委譲し、別の会話や承認画面を生成しない。
import * as vscode from "vscode";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import type { BackendRuntime } from "../session/BackendRuntime";
import { DlcHost } from "./DlcHost";
import { DlcWorkspacePanel } from "./DlcWorkspacePanel";

export function registerDlcCommands(
	context: vscode.ExtensionContext,
	trust: WorkspaceTrustStore,
	runtime: BackendRuntime,
): DlcHost {
	const host = new DlcHost(context, trust, runtime);
	const editor = new DlcWorkspacePanel(context, host, runtime);
	context.subscriptions.push(
		editor,
		vscode.commands.registerCommand("nerita.dlc.openWorkspace", () =>
			editor.open(),
		),
		vscode.window.registerWebviewPanelSerializer("nerita.dlc.workspace", {
			deserializeWebviewPanel(panel) {
				editor.restore(panel);
				return Promise.resolve();
			},
		}),
	);
	for (const name of [
		"create",
		"plan",
		"run",
		"cancel",
		"status",
		"retry",
	] as const) {
		context.subscriptions.push(
			vscode.commands.registerCommand(`nerita.dlc.${name}`, () =>
				host.command(name),
			),
		);
	}
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			editor.dispose();
			void host.reset();
		}),
		{
			dispose: trust.onChange(() => {
				void host.reset();
			}),
		},
	);
	return host;
}
