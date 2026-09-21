// 起動時の設定に従い、共通の寿命管理を持つbackendを組み立てる。
import * as vscode from "vscode";
import type { BackendSession } from "../session/chatSession";
import { requireLocalWorkspace } from "../workspace";
import { attachmentService } from "../webview/attachments";
import { CodexClient } from "./codex/CodexClient";
import { CodexSessionController } from "./codex/CodexSessionController";
import {
	authService,
	interactionService,
} from "./codex/interaction/vscodeServices";
import { PiSessionController } from "./pi/PiSessionController";
import { createPiRuntime } from "./pi/PiRuntime";
import { createPiAuthService } from "./pi/PiAuthService";

/** 両backendで同じローカル・信頼済みworkspace条件を適用する。 */
function workspaceDirectory(): string {
	return requireLocalWorkspace(
		vscode.workspace.workspaceFolders,
		vscode.workspace.isTrusted,
		vscode.env.remoteName,
	);
}

/** 設定変更はウィンドウ再読み込み時に反映し、実行中のbackendを差し替えない。 */
export function createBackend(
	context: vscode.ExtensionContext,
): BackendSession {
	if (
		vscode.workspace
			.getConfiguration("nerita")
			.get<string>("backend", "codex") === "pi"
	) {
		return new PiSessionController(async (signal, authorize, resume) => {
			const cwd = workspaceDirectory();
			const config = vscode.workspace.getConfiguration("nerita.pi");
			const session = await createPiRuntime({
				extensionPath: context.extensionUri.fsPath,
				cwd,
				signal,
				authorize,
				authService: createPiAuthService(context.extensionUri),
				getStorage: () =>
					vscode.workspace
						.getConfiguration("nerita.pi")
						.get<string>("sessionStorage", "global") === "workspace"
						? "workspace"
						: "global",
				...(resume ? { resume } : {}),
				provider: config.get<string>("provider", ""),
				model: config.get<string>("model", ""),
			});
			return { session, cwd };
		});
	}
	return new CodexSessionController(
		async (callbacks, signal) => {
			const cwd = workspaceDirectory();
			const client = await CodexClient.connect({
				extensionPath: context.extensionUri.fsPath,
				cwd,
				callbacks,
				signal,
				clientInfo: {
					name: "vscode_nerita_codex",
					title: "Nerita for Codex",
					version: "0.0.1",
				},
			});
			return { client, cwd };
		},
		attachmentService,
		authService,
		interactionService,
	);
}
