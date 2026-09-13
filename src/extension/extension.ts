// 拡張機能のサービスを組み立て、VS Code の起動条件と終了処理を管理する。
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { createTransport } from "./acp/transport";
import { SessionController } from "./session/sessionController";
import { ChatViewProvider } from "./webview/chatViewProvider";
import { requireLocalWorkspace } from "./workspace";

let controller: SessionController | undefined;
/** サイドバー・コマンド・接続サービスを登録する。 */
export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel("Codex ACP");
	const session = new SessionController((callbacks) => {
		const cwd = requireLocalWorkspace(
			vscode.workspace.workspaceFolders,
			vscode.workspace.isTrusted,
			vscode.env.remoteName,
		);
		const nodePath = vscode.workspace
			.getConfiguration("codex-acp")
			.get<string>("nodePath", "node");
		const adapter = vscode.Uri.joinPath(
			context.extensionUri,
			"dist",
			"runtime",
			"adapter.mjs",
		).fsPath;
		return createTransport(nodePath, adapter, cwd, callbacks, (message) =>
			output.appendLine(message),
		);
	});
	controller = session;
	const provider = new ChatViewProvider(context.extensionUri, session);
	context.subscriptions.push(
		output,
		provider,
		vscode.window.registerWebviewViewProvider("codex-acp.chat", provider),
		vscode.commands.registerCommand("codex-acp.openChat", () =>
			vscode.commands.executeCommand("codex-acp.chat.focus"),
		),
		vscode.commands.registerCommand("codex-acp.newSession", () =>
			session.receive({ type: "session/new", requestId: randomUUID() }),
		),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			session.invalidate();
		}),
	);
}
/** Extension Host の終了までに ACP のプロセスツリーを終了する。 */
export async function deactivate(): Promise<void> {
	await controller?.dispose();
	controller = undefined;
}
