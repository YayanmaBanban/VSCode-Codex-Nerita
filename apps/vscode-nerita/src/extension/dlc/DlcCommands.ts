// DLC 作業画面の開閉と復元を、共通の Host と実行管理へ接続する。
import * as vscode from "vscode";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import type { BackendRuntime } from "../session/BackendRuntime";
import { DlcHost } from "./DlcHost";
import { DlcWorkspacePanel } from "./DlcWorkspacePanel";

/** DLC のコマンドと画面を登録する。拡張機能の初期化時に呼び出し、同じ Host と実行管理を共有する。 */
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
		vscode.commands.registerCommand("nerita.dlc.closeWorkspace", () =>
			editor.dispose(),
		),
		vscode.window.registerWebviewPanelSerializer("nerita.dlc.workspace", {
			deserializeWebviewPanel(panel) {
				editor.restore(panel);
				return Promise.resolve();
			},
		}),
	);
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			editor.dispose();
			void host.reset();
		}),
	);
	return host;
}
