// 起動時の設定に従い、共通の寿命管理を持つバックエンドを組み立てる。

import {
	type PiFactory,
	createPiRuntime,
	type PiModelSelection,
} from "./pi/PiRuntime";

import * as vscode from "vscode";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import type { BackendSession } from "../session/chatSession";
import { ModelConfig } from "../settings/ModelConfig";
import { attachmentService } from "../webview/attachments";
import { requireLocalWorkspace } from "../workspace";
import { CodexClient } from "./codex/CodexClient";
import { CodexSessionController } from "./codex/CodexSessionController";
import {
	authService,
	interactionService,
} from "./codex/interaction/vscodeServices";
import { codexSelectionStore } from "./codex/settings/modelSelection";
import { createPiAuthService } from "./pi/PiAuthService";
import { userTrustedExtensionPaths } from "./pi/PiExtensionTrust";

import { PiSessionController } from "./pi/PiSessionController";
import { sandboxManagement } from "../runtime/SandboxPanel";

/** Codex の接続先に VS Code 標準のワークスペース条件を適用する。 */
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
	trustStore?: WorkspaceTrustStore,
): BackendSession {
	if (
		vscode.workspace
			.getConfiguration("nerita")
			.get<string>("backend", "codex") === "pi"
	) {
		return new PiSessionController(createPiFactory(context, trustStore));
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
					title: "Nerita",
					version: "0.0.1",
				},
			});
			return { client, cwd };
		},
		attachmentService,
		authService,
		interactionService,
		codexSelectionStore({
			read: () => modelConfig(workspaceDirectory()).read("codex"),
			write: (selection) =>
				modelConfig(workspaceDirectory()).write("codex", selection),
		}),
	);
}

/** 最新の作業ルートと設定から Pi の会話を起動する。 */
function createPiFactory(
	context: vscode.ExtensionContext,
	trustStore: WorkspaceTrustStore | undefined,
): PiFactory {
	const sandbox = sandboxManagement(context);
	const commandPermissions = sandbox.commands;
	return async (signal, authorize, resume) => {
		await commandPermissions.clearSession();
		const folders = vscode.workspace.workspaceFolders;
		let folder = folders?.[0];
		if (folders && folders.length > 1) {
			folder = await vscode.window.showWorkspaceFolderPick({
				placeHolder: "この会話の作業rootを選択してください",
			});
			if (!folder) {
				throw new Error("作業rootの選択を取り消しました。");
			}
		}
		const cwd = requireLocalWorkspace(
			folder ? [folder] : undefined,
			true,
			vscode.env.remoteName,
		);
		const config = modelConfig(cwd);
		const preferredModel = storedPiModel(await config.read("pi"));
		const session = await createPiRuntime({
			commandPermissions,
			sandboxManagement: sandbox,
			extensionPath: context.extensionUri.fsPath,
			cwd,
			workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map(
				(folder) => folder.uri.fsPath,
			),
			workspaceTrusted: vscode.workspace.isTrusted,
			...(trustStore ? { trustStore } : {}),
			trustEnabled: () => vscode.workspace.isTrusted,
			trustedExtensionPaths: userTrustedExtensionPaths(
				vscode.workspace
					.getConfiguration("nerita.pi")
					.inspect<string[]>("trustedExtensionPaths"),
			),
			codemode: vscode.workspace
				.getConfiguration("nerita.pi")
				.get<boolean>("codemode", false),
			toolSearch: vscode.workspace
				.getConfiguration("nerita.pi")
				.get<boolean>("toolSearch", false),
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
			saveModel: (selection) => config.write("pi", selection),
		});
		return { session, cwd };
	};
}

/** Pi の接続に必要なプロバイダーとモデルが揃っている場合だけ復元する。 */
function storedPiModel(value: unknown): PiModelSelection | undefined {
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

/** エディターで未保存の設定を、モデル選択によって上書きしない。 */
function modelConfig(root: string): ModelConfig {
	return new ModelConfig(root, undefined, (file) => {
		const uri = vscode.Uri.file(file).toString();
		if (
			vscode.workspace.textDocuments.some(
				(document) =>
					document.isDirty && document.uri.toString() === uri,
			)
		) {
			throw new Error(
				"config.toml に未保存の編集があります。保存してから再試行してください。",
			);
		}
	});
}

/** 未対応の推論値は候補との照合へ渡し、文字列以外の値は除外する。 */
function storedReasoning(value: object): { reasoning?: string } {
	return "reasoning" in value && typeof value.reasoning === "string"
		? { reasoning: value.reasoning }
		: {};
}
