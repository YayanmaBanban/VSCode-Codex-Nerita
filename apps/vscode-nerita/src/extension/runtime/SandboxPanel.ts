// Sandbox 管理パネルを登録し、Host の拒否イベントへの操作・権限取消し・起動検査を受け付ける。
import { errorText } from "@nerita/shared/errorText";
import * as vscode from "vscode";
import {
	sandboxRequestSchema,
	type SandboxRequest,
	type SandboxReply,
} from "@nerita/shared/sandboxManagement";
import { webviewHtml } from "../webview/webviewHtml";
import { SandboxManagement } from "./SandboxManagement";
import { probeMxc } from "./MxcAvailability";

const managers = new WeakMap<
	vscode.ExtensionContext,
	Map<string, { manager: SandboxManagement; label: string; scope: string }>
>();

/** 同じ Host の実行経路と管理画面で承認ストアを二重生成しない。 */
export function sandboxManagement(
	context: vscode.ExtensionContext,
	id = "chat",
	label = "Chat",
	scope = "default",
): SandboxManagement {
	let registry = managers.get(context);
	if (!registry) {
		registry = new Map();
		managers.set(context, registry);
	}
	let manager =
		registry.get(id)?.scope === scope
			? registry.get(id)?.manager
			: undefined;
	if (!manager) {
		const notify = () => {
			for (const entry of registry.values()) {
				if (entry.scope === scope) {
					entry.manager.commands.refreshWorkspace();
					entry.manager.resourceGrants.refreshWorkspace();
				}
			}
		};
		manager = new SandboxManagement(
			{
				read: () =>
					context.globalState.get(
						`nerita.commandPermissions.${scope}`,
					),
				write: async (grants) => {
					await context.globalState.update(
						`nerita.commandPermissions.${scope}`,
						grants,
					);
					notify();
				},
			},
			{
				read: () =>
					context.globalState.get(`nerita.resourceGrants.${scope}`),
				write: async (state) => {
					await context.globalState.update(
						`nerita.resourceGrants.${scope}`,
						state,
					);
					notify();
				},
			},
		);
		registry.set(id, { manager, label, scope });
	}
	return manager;
}

/** 通常のエディタグループへ開き、パネルを閉じたら検査と購読も回収する。 */
export function registerSandboxPanel(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"nerita.pi.sandboxSettings",
			async () => {
				const entries = [...(managers.get(context)?.values() ?? [])];
				const selected =
					entries.length > 1
						? await vscode.window.showQuickPick(
								entries.map((entry) => ({
									label: entry.label,
									entry,
								})),
								{ placeHolder: "Sandbox を確認する実行環境" },
							)
						: undefined;
				if (entries.length > 1 && !selected) {
					return;
				}
				const entry = selected?.entry ?? entries[0];
				openSandboxPanel(
					context,
					entry?.manager ?? sandboxManagement(context),
				);
			},
		),
	);
}

/** 終了した Run は選択候補から外す。既に開いているパネルは失効した状態を表示する。 */
export function releaseSandboxManagement(
	context: vscode.ExtensionContext,
	id: string,
	expected: SandboxManagement,
): void {
	const registry = managers.get(context);
	if (registry?.get(id)?.manager === expected) {
		registry.delete(id);
	}
}

/** Webview から任意の起動引数や新しい許可を受け付けない。 */
async function handleSandboxRequest(
	request: Exclude<SandboxRequest, { type: "ready" }>,
	context: vscode.ExtensionContext,
	manager: SandboxManagement,
	signal: AbortSignal,
) {
	if (request.type === "revoke") {
		await manager.commands.revoke(request.permission);
		return;
	}
	if (request.type === "revoke-resource" || request.type === "revoke-cache") {
		await manager.resourceGrants.revoke(
			request.id,
			request.type === "revoke-cache",
		);
		return;
	}
	if (request.type === "denial-action") {
		await manager.decide(request.decision);
		return;
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (
		!folder ||
		!vscode.workspace.isTrusted ||
		folder.uri.scheme !== "file"
	) {
		throw new Error(
			"起動検査には信頼済みのローカルワークスペースが必要です。",
		);
	}
	manager.availability(
		await probeMxc(context.extensionUri.fsPath, folder.uri.fsPath, signal),
	);
}

/** パネルごとの通信・購読・取消しを閉じた寿命で管理する。 */
function openSandboxPanel(
	context: vscode.ExtensionContext,
	manager: SandboxManagement,
) {
	const panel = vscode.window.createWebviewPanel(
		"nerita.pi.sandbox",
		"Sandbox",
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, "dist/webview"),
			],
		},
	);
	panel.webview.html = webviewHtml(
		panel.webview,
		context.extensionUri,
		"sandbox",
	);
	const abort = new AbortController();
	let busy = false;
	const post = (reply: SandboxReply) => {
		if (!abort.signal.aborted) {
			void panel.webview.postMessage(reply);
		}
	};
	const publish = () =>
		post({ type: "state", state: manager.snapshot(), busy });
	const unsubscribe = manager.subscribe(publish);
	const listener = panel.webview.onDidReceiveMessage((value: unknown) => {
		const parsed = sandboxRequestSchema.safeParse(value);
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "ready") {
			publish();
			return;
		}
		if (busy) {
			return;
		}
		busy = true;
		publish();
		void handleSandboxRequest(parsed.data, context, manager, abort.signal)
			.catch((error: unknown) =>
				post({
					type: "error",
					message:
						error instanceof Error
							? error.message
							: errorText(error),
				}),
			)
			.finally(() => {
				busy = false;
				publish();
			});
	});
	panel.onDidDispose(() => {
		abort.abort();
		unsubscribe();
		listener.dispose();
	});
}
