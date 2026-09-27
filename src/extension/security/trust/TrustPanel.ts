// 保存済みの Trust 記録をエディターで管理し、操作は Host で検証する。
import * as vscode from "vscode";
import {
	trustRequestSchema,
	type TrustReply,
	type TrustRequest,
} from "../../../shared/workspaceTrust";
import { webviewHtml } from "../../webview/webviewHtml";
import type { WorkspaceTrustStore } from "./WorkspaceTrustStore";

/** 管理画面を再利用し、閉じた画面からの待機中の操作を破棄する。 */
export function trustPanel(
	context: vscode.ExtensionContext,
	store: WorkspaceTrustStore,
	confirmTrust: (root: string, active: () => boolean) => Promise<void>,
) {
	let panel: vscode.WebviewPanel | undefined;
	return () => {
		if (panel) {
			panel.reveal();
			return;
		}
		const current = vscode.window.createWebviewPanel(
			"nerita.trust",
			"Nerita Trust",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, "dist/webview"),
				],
			},
		);
		panel = current;
		let closed = false;
		let queue = Promise.resolve();
		const publish = (error: string | null = null) => {
			if (!closed) {
				void current.webview.postMessage({
					type: "state",
					records: store.list(),
					error,
				} satisfies TrustReply);
			}
		};
		const unsubscribe = store.onChange(() => publish());
		const updateRecord = async (
			request: Extract<TrustRequest, { root: string }>,
		) => {
			if (!store.list().some((record) => record.root === request.root)) {
				throw new Error(
					"対象の記録がありません。再読み込みしてください。",
				);
			}
			if (request.type === "trust") {
				await confirmTrust(request.root, () => !closed);
				return;
			}
			if (request.type === "revoke") {
				await store.setUserTrust(request.root, false);
				return;
			}
			const answer = await vscode.window.showWarningMessage(
				"Trust の記録を削除しますか？",
				{
					modal: true,
					detail: `${request.root}\nフォルダーやファイルは削除しません。再度開いた場合は未信頼として登録されます。`,
				},
				"記録を削除",
			);
			if (!closed && answer === "記録を削除") {
				await store.remove(request.root);
			}
		};
		const receive = current.webview.onDidReceiveMessage(
			(value: unknown) => {
				const parsed = trustRequestSchema.safeParse(value);
				if (!parsed.success) {
					return;
				}
				queue = queue
					.then(async () => {
						if (closed) {
							return;
						}
						const request = parsed.data;
						if (request.type === "add") {
							const folders = await vscode.window.showOpenDialog({
								canSelectFiles: false,
								canSelectFolders: true,
								canSelectMany: false,
								title: "Trust を管理するフォルダー",
							});
							if (!closed && folders?.[0]) {
								await store.registerWorkspace(
									folders[0].fsPath,
								);
							}
						} else if (request.type !== "refresh") {
							await updateRecord(request);
						}
						publish();
					})
					.catch((error: unknown) => publish(String(error)));
			},
		);
		current.onDidDispose(() => {
			closed = true;
			unsubscribe();
			receive.dispose();
			panel = undefined;
		});
		current.webview.html = webviewHtml(
			current.webview,
			context.extensionUri,
			"workspace-trust",
		);
		context.subscriptions.push(current);
	};
}
