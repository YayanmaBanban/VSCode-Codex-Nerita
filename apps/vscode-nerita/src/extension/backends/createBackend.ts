// 起動時の設定に従い、共通の寿命管理を持つバックエンドを組み立てる。

import {
	type PiFactory,
	createPiRuntime,
	type PiModelSelection,
} from "./pi/PiRuntime";

import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
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
import {
	sandboxManagement,
	releaseSandboxManagement,
} from "../runtime/SandboxPanel";
import { credentialService } from "../credentials/CredentialService";
import type { BackendId } from "@nerita/shared/backend";

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
	backend?: BackendId,
	executionRoot?: string,
): BackendSession {
	if (
		(backend ??
			vscode.workspace
				.getConfiguration("nerita")
				.get<string>("backend", "codex")) === "pi"
	) {
		return new PiSessionController(
			createPiFactory(context, trustStore, executionRoot),
		);
	}
	return new CodexSessionController(
		async (callbacks, signal) => {
			const cwd = await explicitDirectory(executionRoot, trustStore);
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
			read: () =>
				modelConfig(executionRoot ?? workspaceDirectory()).read(
					"codex",
				),
			write: (selection) =>
				modelConfig(executionRoot ?? workspaceDirectory()).write(
					"codex",
					selection,
				),
		}),
	);
}

/** 最新の作業ルートと設定から Pi の会話を起動する。 */
function createPiFactory(
	context: vscode.ExtensionContext,
	trustStore: WorkspaceTrustStore | undefined,
	executionRoot: string | undefined,
): PiFactory {
	const sandboxId = executionRoot !== undefined ? randomUUID() : "chat";
	return async (signal, authorize, resume) => {
		const cwd = await piDirectory(executionRoot, trustStore);
		const sandbox = await piSandbox(context, sandboxId, cwd, signal);
		const commandPermissions = sandbox.commands;
		const config = modelConfig(cwd);
		const preferredModel = storedPiModel(await config.read("pi"));
		const session = await createPiRuntime({
			credentials: credentialService(context).piStore(),
			mcpBackend: () => credentialService(context).mcpBackend(),
			credentialBroker: credentialService(context).broker(
				cwd,
				commandPermissions,
			),
			commandPermissions,
			sandboxManagement: sandbox,
			extensionPath: context.extensionUri.fsPath,
			cwd,
			workspaceRoots: [cwd],
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

async function piDirectory(
	executionRoot: string | undefined,
	trustStore: WorkspaceTrustStore | undefined,
): Promise<string> {
	const folders = vscode.workspace.workspaceFolders;
	let folder = folders?.[0];
	if (executionRoot === undefined && folders && folders.length > 1) {
		folder = await vscode.window.showWorkspaceFolderPick({
			placeHolder: "この会話の作業フォルダーを選択してください",
		});
		if (!folder) {
			throw new Error("作業フォルダーの選択を取り消しました。");
		}
	}
	const selectedRoot =
		executionRoot ??
		requireLocalWorkspace(
			folder ? [folder] : undefined,
			true,
			vscode.env.remoteName,
		);
	return explicitDirectory(selectedRoot, trustStore);
}
async function piSandbox(
	context: vscode.ExtensionContext,
	sandboxId: string,
	cwd: string,
	signal: AbortSignal,
) {
	const scope = createHash("sha256")
		.update(process.platform === "win32" ? cwd.toLowerCase() : cwd)
		.digest("hex");
	const sandbox = sandboxManagement(
		context,
		sandboxId,
		`${basename(cwd)} · ${sandboxId === "chat" ? "Chat" : "DLC"}`,
		scope,
	);
	await sandbox.startSession(signal);
	signal.addEventListener(
		"abort",
		() => releaseSandboxManagement(context, sandboxId, sandbox),
		{ once: true },
	);
	return sandbox;
}

/** UI の表示位置から実行先を推定せず、信頼済みの実体ルートを接続へ渡す。 */
async function explicitDirectory(
	root: string | undefined,
	trust: WorkspaceTrustStore | undefined,
): Promise<string> {
	if (!vscode.workspace.isTrusted || vscode.env.remoteName !== undefined) {
		throw new Error("信頼済みのローカル環境で実行してください。");
	}
	const cwd = await realpath(root ?? workspaceDirectory());
	if (trust && !(await trust.trusted(cwd))) {
		throw new Error("実行先の Nerita Trust を確認してください。");
	}
	return cwd;
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
		value.provider.trim() === "" ||
		value.model.trim() === ""
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
