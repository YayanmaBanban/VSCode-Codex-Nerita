// 起動時の設定に従い、共通の寿命管理を持つバックエンドを組み立てる。
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
import { createPiRuntime, type PiModelSelection } from "./pi/PiRuntime";
import { createPiAuthService } from "./pi/PiAuthService";
import { codexSelectionStore } from "./codex/settings/modelSelection";
import { userTrustedExtensionPaths } from "./pi/PiExtensionTrust";

const piModelSelectionKey = "nerita.pi.lastModel";

/** 両バックエンドで同じローカル・信頼済みワークスペース条件を適用する。 */
function workspaceDirectory(): string {
	return requireLocalWorkspace(
		vscode.workspace.workspaceFolders,
		vscode.workspace.isTrusted,
		vscode.env.remoteName,
	);
}

/** 起動・切替時の最新設定を読み、使用するバックエンドを生成する。 */
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
			const preferredModel = storedPiModel(context);
			const session = await createPiRuntime({
				extensionPath: context.extensionUri.fsPath,
				cwd,
				workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map(
					(folder) => folder.uri.fsPath,
				),
				workspaceTrusted: vscode.workspace.isTrusted,
				trustedExtensionPaths: userTrustedExtensionPaths(
					vscode.workspace
						.getConfiguration("nerita.pi")
						.inspect<string[]>("trustedExtensionPaths"),
				),
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
				...(preferredModel ? { preferredModel } : {}),
				saveModel: (selection) =>
					Promise.resolve(
						context.globalState.update(
							piModelSelectionKey,
							selection,
						),
					),
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
		codexSelectionStore(context.globalState),
	);
}

/** 壊れた旧データを起動失敗へ波及させず、既知の保存形式だけを読む。 */
function storedPiModel(
	context: vscode.ExtensionContext,
): PiModelSelection | undefined {
	const value: unknown = context.globalState.get(piModelSelectionKey);
	if (
		typeof value !== "object" ||
		value === null ||
		!("provider" in value) ||
		!("model" in value) ||
		typeof value.provider !== "string" ||
		typeof value.model !== "string" ||
		!value.provider.trim() ||
		!value.model.trim()
	) {
		return undefined;
	}
	return {
		provider: value.provider.trim(),
		model: value.model.trim(),
		...storedReasoning(value),
	};
}

/** 未知の保存値は候補照合へ渡し、型が壊れた推論値だけを除外する。 */
function storedReasoning(value: object): { reasoning?: string } {
	return "reasoning" in value && typeof value.reasoning === "string"
		? { reasoning: value.reasoning }
		: {};
}
