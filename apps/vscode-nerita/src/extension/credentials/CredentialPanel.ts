// 資格情報の管理画面は秘密値を受信せず、秘密入力と移行の確定を Host の対話で行う。
import { loadPiSdk } from "../backends/pi/PiSdk";
import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	credentialRequestSchema,
	type CredentialRequest,
	type CredentialReply,
} from "@nerita/shared/credentials";
import { credentialService, type CredentialService } from "./CredentialService";
import type { BindingStore } from "./BindingStore";
import { providerExecutable } from "./ProviderProcess";
import { prepareMcpAuthMigration } from "./McpAuthMigration";
import { preparePiAuthMigration } from "./PiAuthMigration";
import { selectLocalWorkspace } from "../webview/selectLocalWorkspace";
import { webviewHtml } from "../webview/webviewHtml";

/** フォルダを開き直した後やパネル破棄後の保存は拒否する。 */
async function assertWorkspace(root: string, signal: AbortSignal) {
	signal.throwIfAborted();
	if (!vscode.workspace.isTrusted) {
		throw new Error("信頼済みのワークスペースが必要です。");
	}
	const roots = await Promise.all(
		(vscode.workspace.workspaceFolders ?? [])
			.filter((folder) => folder.uri.scheme === "file")
			.map((folder) => realpath(folder.uri.fsPath)),
	);
	if (!roots.includes(root)) {
		throw new Error("ワークスペースが変更されました。");
	}
	const file = vscode.Uri.file(
		join(root, ".nerita/bindings.json"),
	).toString();
	const matchesSome = vscode.workspace.textDocuments.some(
		(document) => document.isDirty && document.uri.toString() === file,
	);
	if (matchesSome) {
		throw new Error("Binding に未保存の編集があります。");
	}
}

/** トークンを Webview の入力欄へ渡さず、VS Code の password 入力を使う。 */
async function handleRequest(
	request: Exclude<CredentialRequest, { type: "ready" }>,
	root: string,
	context: vscode.ExtensionContext,
	service: CredentialService,
	bindings: BindingStore,
	signal: AbortSignal,
) {
	await assertWorkspace(root, signal);
	if (request.type === "save-binding") {
		await bindings.update((items) => [
			...items.filter((item) => item.id !== request.binding.id),
			request.binding,
		]);
		return;
	}
	if (request.type === "delete-binding") {
		await bindings.update((items) =>
			items.filter((item) => item.id !== request.id),
		);
		return;
	}
	if (request.type === "bws-logout") {
		await service.logoutBws(request.accountId);
		return;
	}
	if (request.type === "bws-login") {
		const token = await vscode.window.showInputBox({
			title: "Bitwarden Secrets Manager",
			prompt: "マシンアカウントのアクセストークン",
			password: true,
			ignoreFocusOut: true,
		});
		await assertWorkspace(root, signal);
		if (token !== undefined) {
			await service.loginBws(request.accountId, request.mode, token);
		}
		return;
	}
	await migrateAuth(request, root, context, service, signal);
}

/** 候補の可否と保存モードだけを公開し、Provider の acquire は起動しない。 */
async function snapshot(
	root: string,
	bindings: BindingStore,
	service: CredentialService,
	busy: boolean,
): Promise<Extract<CredentialReply, { type: "state" }>> {
	const available = Boolean(await providerExecutable("bws", root));
	const accounts = await Promise.all(
		service.bwsAccounts().map(async (accountId) => {
			const token = await service.bws.get(`bws.auth.${accountId}`);
			const authenticated = Boolean(token);
			token?.dispose();
			return {
				id: "bitwarden-secrets-manager",
				accountId,
				available,
				authenticated,
				mode: service.bwsMode(accountId),
			};
		}),
	);
	return {
		type: "state",
		busy,
		bindings: await bindings.read(),
		providers: [
			{
				id: "git",
				available: Boolean(await providerExecutable("git", root)),
				authenticated: false,
				mode: null,
			},
			{ id: "npmrc", available: true, authenticated: false, mode: null },
			...accounts,
		],
	};
}

/** 資格情報の管理画面を開くコマンドを登録する。拡張機能の初期化時に一度呼び出す。 */
export function registerCredentialPanel(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("nerita.credentials.manage", () =>
			openCredentialPanel(context),
		),
	);
}

/** パネルの寿命と操作中の状態を共有する。 */
async function openCredentialPanel(context: vscode.ExtensionContext) {
	const selected = await selectLocalWorkspace();
	if (!selected) {
		return;
	}
	const { root } = selected;
	const service = credentialService(context);
	const bindings = service.bindings(root);

	const panel = vscode.window.createWebviewPanel(
		"nerita.credentials",
		"資格情報を管理",
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, "dist/webview"),
			],
		},
	);
	bindCredentialPanel(panel, root, context, service, bindings);
	panel.webview.html = webviewHtml(
		panel.webview,
		context.extensionUri,
		"credentials",
	);
	context.subscriptions.push(panel);
}
/** パネル破棄と更新処理の終了を同じ寿命にする。 */
function bindCredentialPanel(
	panel: vscode.WebviewPanel,
	root: string,
	context: vscode.ExtensionContext,
	service: CredentialService,
	bindings: BindingStore,
) {
	const lifetime = new AbortController();
	let busy = false;
	let generation = 0;
	let current: Extract<CredentialReply, { type: "state" }> | undefined;
	/** 資格情報の画面が有効な間だけ応答を送信し、閉じた画面へ秘密情報の操作結果を送らない。 */
	const post = (reply: CredentialReply) => {
		if (!lifetime.signal.aborted) {
			void panel.webview.postMessage(reply);
		}
	};
	/** 資格情報の状態を取得し、最後に要求した世代の結果だけで表示を更新する。 */
	const publish = async () => {
		const revision = ++generation;
		try {
			const state = await snapshot(root, bindings, service, busy);
			if (revision === generation) {
				current = state;
				post(state);
			}
		} catch {
			post({
				type: "error",
				message: "資格情報の設定を読み込めません。",
			});
		}
	};
	/** 資格情報の変更要求を処理し、成功・失敗にかかわらず待機表示を解除して状態を再取得する。 */
	const runRequest = async (
		request: Exclude<CredentialRequest, { type: "ready" }>,
	) => {
		try {
			await handleCredentialRequestAndReply(
				post,
				request,
				root,
				context,
				service,
				bindings,
				lifetime.signal,
			);
		} finally {
			busy = false;
			await publish();
		}
	};
	/** 要求の形式を検証し、同時操作を拒否してから管理状態の世代を進める。 */
	const receiveCredentialRequest = (value: unknown) => {
		const parsed = credentialRequestSchema.safeParse(value);
		if (!parsed.success) {
			post({ type: "error", message: "資格情報の設定形式が不正です。" });
			return;
		}
		if (parsed.data.type === "ready") {
			void publish();
			return;
		}
		if (busy) {
			return;
		}
		busy = true;
		generation++;
		if (current) {
			post({ ...current, busy: true });
		}
		void runRequest(parsed.data);
	};
	const listener = panel.webview.onDidReceiveMessage(
		receiveCredentialRequest,
	);
	panel.onDidDispose(() => {
		lifetime.abort();
		listener.dispose();
	});
}
/** 移行の種類と確定操作を明示し、モデルと MCP の認証を混ぜない。 */
async function migrateAuth(
	request: Extract<CredentialRequest, { type: "migrate-pi" | "migrate-mcp" }>,
	root: string,
	context: vscode.ExtensionContext,
	service: CredentialService,
	signal: AbortSignal,
) {
	const sdk = await loadPiSdk(context.extensionUri.fsPath);
	const choice =
		request.type === "migrate-mcp"
			? { mode: "secret-storage" as const }
			: await vscode.window.showQuickPick(
					[
						{
							label: "VS Code に保存",
							mode: "secret-storage" as const,
						},
						{
							label: "このセッションのみ",
							mode: "session" as const,
						},
					],
					{ title: "既存 Pi 認証の移行先" },
				);
	if (!choice) {
		return;
	}
	await assertWorkspace(root, signal);
	const migration =
		request.type === "migrate-mcp"
			? await prepareMcpAuthMigration(
					join(sdk.getAgentDir(), "mcp-auth.json"),
					service.stores.persistent,
					await service.mcpBackend(),
				)
			: await preparePiAuthMigration(
					join(sdk.getAgentDir(), "auth.json"),
					service.vault,
					choice.mode,
				);
	try {
		const confirmed = await vscode.window.showInformationMessage(
			`${migration.count} 件の保存と読み戻しを検証しました。元の認証ファイルを保持して移行を確定します。`,
			{ modal: true },
			"移行を確定",
		);
		await assertWorkspace(root, signal);
		if (confirmed === "移行を確定") {
			await migration.commit();
		}
	} finally {
		await migration.cancel();
	}
}

/** 実行結果を画面へ返し、資格情報を含む可能性のある生の例外を公開しない。 */
async function handleCredentialRequestAndReply(
	post: (reply: CredentialReply) => void,
	...args: Parameters<typeof handleRequest>
): Promise<void> {
	try {
		await handleRequest(...args);
		post({ type: "notice", message: "操作が終了しました。" });
	} catch {
		post({
			type: "error",
			message:
				"設定を更新できません。信頼・入力内容・保存先を確認してください。",
		});
	}
}
