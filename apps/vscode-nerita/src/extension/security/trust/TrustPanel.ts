// 保存済みの信頼記録をエディターで管理し、操作は Host で検証する。
import { errorText } from "@nerita/shared/errorText";

import * as vscode from "vscode";
import {
	trustRequestSchema,
	type TrustReply,
	type TrustRequest,
} from "@nerita/shared/workspaceTrust";
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
		const panelState = { closed: false };
		const pending = { queue: Promise.resolve() };
		const publish = (error: string | null = null) => {
			if (!panelState.closed) {
				void current.webview.postMessage({
					type: "state",
					records: store.list(),
					error,
				} satisfies TrustReply);
			}
		};
		const unsubscribe = store.onChange(() => publish());
		const updateRecord = createTrustRecordUpdater(
			store,
			confirmTrust,
			panelState,
		);
		const receive = current.webview.onDidReceiveMessage(
			createTrustRequestListener(
				pending,
				panelState,
				store,
				updateRecord,
				publish,
			),
		);
		current.onDidDispose(() => {
			panelState.closed = true;
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

/** 閉じた画面からの要求を除外し、信頼記録の操作を1件ずつ処理する。 */
function createTrustRequestListener(
	pending: { queue: Promise<void> },
	panelState: { closed: boolean },
	store: WorkspaceTrustStore,
	updateRecord: (
		request: Extract<TrustRequest, { root: string }>,
	) => Promise<void>,
	publish: (error?: string | null) => void,
): (value: unknown) => void {
	return (value: unknown) => {
		const parsed = trustRequestSchema.safeParse(value);
		if (!parsed.success) {
			return;
		}
		pending.queue = pending.queue
			.then(async () => {
				if (panelState.closed) {
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
					// フォルダー選択の待機中にパネルが閉じられる場合がある。
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
					if (!panelState.closed && folders?.[0]) {
						await store.registerWorkspace(folders[0].fsPath);
					}
				} else if (request.type !== "refresh") {
					await updateRecord(request);
				}
				publish();
			})
			.catch((error: unknown) => publish(errorText(error)));
	};
}

/** 画面を閉じた場合は確認待ちの操作を破棄する。 */
function createTrustRecordUpdater(
	store: WorkspaceTrustStore,
	confirmTrust: (root: string, active: () => boolean) => Promise<void>,
	panelState: { closed: boolean },
) {
	return async (request: Extract<TrustRequest, { root: string }>) => {
		if (!store.list().some((record) => record.root === request.root)) {
			throw new Error("対象の記録がありません。再読み込みしてください。");
		}
		if (request.type === "trust") {
			await confirmTrust(request.root, () => !panelState.closed);
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
		if (!panelState.closed && answer === "記録を削除") {
			await store.remove(request.root);
		}
	};
}
