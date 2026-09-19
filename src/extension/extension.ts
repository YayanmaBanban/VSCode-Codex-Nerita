// 拡張機能のサービスを組み立て、VS Code の起動条件と終了処理を管理する。
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { CodexClient } from "./codex/CodexClient";
import { CodexSessionController } from "./codex/CodexSessionController";
import { ChatViewProvider } from "./webview/chatViewProvider";
import { requireLocalWorkspace } from "./workspace";
import { attachmentService } from "./webview/attachments";
import { disposeDroppedAttachments } from "./webview/droppedAttachments";
import {
	authService,
	interactionService,
} from "./codex/interaction/vscodeServices";

let controller: CodexSessionController | undefined;
/** サイドバー・コマンド・接続サービスを登録する。 */
export function activate(context: vscode.ExtensionContext): void {
	const session = new CodexSessionController(
		async (callbacks, signal) => {
			const cwd = requireLocalWorkspace(
				vscode.workspace.workspaceFolders,
				vscode.workspace.isTrusted,
				vscode.env.remoteName,
			);
			const client = await CodexClient.connect({
				extensionPath: context.extensionUri.fsPath,
				cwd,
				callbacks,
				signal,
				clientInfo: {
					name: "vscode_codex",
					title: "VS Code Codex",
					version: "0.0.1",
				},
			});
			return { client, cwd };
		},
		attachmentService,
		authService,
		interactionService,
	);
	controller = session;
	const provider = new ChatViewProvider(context.extensionUri, session);
	context.subscriptions.push(
		provider,
		vscode.window.registerWebviewViewProvider("codex-acp.chat", provider),
		vscode.commands.registerCommand("codex-acp.openChat", () =>
			vscode.commands.executeCommand("codex-acp.chat.focus"),
		),
		vscode.commands.registerCommand("codex-acp.newSession", () =>
			session.receive({ type: "session/new", requestId: randomUUID() }),
		),
		vscode.commands.registerCommand(
			"codex-acp.codeBlock",
			(context: unknown) => provider.convertSelectionToCodeBlock(context),
		),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			session.invalidate();
		}),
	);
}
/** Extension Host の終了までに App Server のプロセスツリーを終了する。 */
export async function deactivate(): Promise<void> {
	await controller?.dispose();
	controller = undefined;
	await disposeDroppedAttachments();
}
