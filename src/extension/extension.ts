// 拡張機能のサービスを組み立て、VS Code の起動条件と終了処理を管理する。
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { createBackend } from "./backends/createBackend";
import type { BackendSession } from "./session/chatSession";
import { BackendRuntime } from "./session/BackendRuntime";
import { ChatViewProvider } from "./webview/chatViewProvider";
import { disposeDroppedAttachments } from "./webview/droppedAttachments";
import { registerSandboxSetup } from "./backends/codex/settings/sandboxSetup";
import { registerGuardrailsEditor } from "./backends/pi/guardrails/GuardrailsEditor";
let controller: BackendSession | undefined;
/** サイドバー・コマンド・接続サービスを登録する。 */
export async function activate(
	context: vscode.ExtensionContext,
): Promise<void> {
	registerSandboxSetup(context);
	const guardrails = await registerGuardrailsEditor(context);
	const session = new BackendRuntime(() => createBackend(context));
	controller = session;
	const provider = new ChatViewProvider(context.extensionUri, session, () =>
		session.restart(),
	);
	context.subscriptions.push(
		provider,
		vscode.window.registerWebviewViewProvider(
			"nerita.codex.chat",
			provider,
		),
		vscode.commands.registerCommand("nerita.codex.openChat", () =>
			vscode.commands.executeCommand("nerita.codex.chat.focus"),
		),
		vscode.commands.registerCommand("nerita.codex.newSession", () =>
			session.receive({ type: "session/new", requestId: randomUUID() }),
		),
		vscode.commands.registerCommand(
			"nerita.codex.codeBlock",
			(context: unknown) => provider.convertSelectionToCodeBlock(context),
		),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			session.invalidate();
			void guardrails
				.restore()
				.catch((error: unknown) =>
					vscode.window.showErrorMessage(
						`ガードレールを復元できません: ${String(error)}`,
					),
				);
		}),
	);
	// 表示の再生成では再接続せず、拡張機能の起動につき一度だけ試す。
	void session.receive({ type: "connection/retry", requestId: randomUUID() });
}
/** Extension Host の終了までに App Server のプロセスツリーを終了する。 */
export async function deactivate(): Promise<void> {
	await controller?.dispose();
	controller = undefined;
	await disposeDroppedAttachments();
}
