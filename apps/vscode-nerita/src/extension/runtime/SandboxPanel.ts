// Sandbox 管理パネルを登録し、Host の拒否イベントへの操作・権限取消し・起動検査を受け付ける。
import * as vscode from "vscode";
import {
	sandboxRequestSchema,
	type SandboxRequest,
	type SandboxReply,
} from "@nerita/shared/sandboxManagement";
import { webviewHtml } from "../webview/webviewHtml";
import { SandboxManagement } from "./SandboxManagement";
import { probeMxc } from "./MxcAvailability";

const managers = new WeakMap<vscode.ExtensionContext, SandboxManagement>();

/** 同じ Host の実行経路と管理画面で承認ストアを二重生成しない。 */
export function sandboxManagement(
	context: vscode.ExtensionContext,
): SandboxManagement {
	let manager = managers.get(context);
	if (!manager) {
		manager = new SandboxManagement(
			{
				read: () =>
					context.workspaceState.get("nerita.commandPermissions"),
				write: async (grants) => {
					await context.workspaceState.update(
						"nerita.commandPermissions",
						grants,
					);
				},
			},
			{
				read: () => context.workspaceState.get("nerita.resourceGrants"),
				write: async (state) => {
					await context.workspaceState.update(
						"nerita.resourceGrants",
						state,
					);
				},
			},
		);
		managers.set(context, manager);
	}
	return manager;
}

/** 通常のエディタグループへ開き、パネルを閉じたら検査と購読も回収する。 */
export function registerSandboxPanel(context: vscode.ExtensionContext) {
	const manager = sandboxManagement(context);
	context.subscriptions.push(
		vscode.commands.registerCommand("nerita.pi.sandboxSettings", () => {
			openSandboxPanel(context, manager);
		}),
	);
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
						error instanceof Error ? error.message : String(error),
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
