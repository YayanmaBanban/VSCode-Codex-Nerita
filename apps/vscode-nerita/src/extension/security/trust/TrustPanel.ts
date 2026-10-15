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
import type { BackendId } from "@nerita/shared/backend";
import { configuredBackend } from "../../webview/backendSettings";
import { TrustConfirmationState } from "./TrustConfirmation";

/** パネルが表示中の保存先と、待機中操作の失効状態を保持する。 */
type PanelState = { closed: boolean; backend: BackendId };
/** 変更中の通知は操作完了の一覧へまとめ、古い状態の途中送信を防ぐ。 */
type PendingRequests = { queue: Promise<void>; active: boolean };

/** 管理画面を再利用し、閉じた画面からの待機中の操作を破棄する。 */
export function trustPanel(
	context: Pick<
		vscode.ExtensionContext,
		"extensionUri" | "globalStorageUri" | "subscriptions"
	>,
	store: WorkspaceTrustStore,
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
		const panelState: PanelState = {
			closed: false,
			backend: configuredBackend(),
		};
		const pending: PendingRequests = {
			queue: Promise.resolve(),
			active: false,
		};
		const confirmation = new TrustConfirmationState(store);
		// `globalState` はプロファイルの `globalStorage` にある VS Code 管理の DB に保存される。
		const piStoragePath = vscode.Uri.joinPath(
			context.globalStorageUri,
			"..",
			"state.vscdb",
		).fsPath;
		const publish = createTrustPublisher(
			current,
			store,
			panelState,
			piStoragePath,
			confirmation,
		);
		const unsubscribe = store.onChange(() => {
			if (!pending.active) {
				pending.queue = pending.queue.then(() => publish());
			}
		});
		const receive = current.webview.onDidReceiveMessage(
			createTrustRequestListener(
				pending,
				panelState,
				store,
				createTrustRecordUpdater(store, confirmation, panelState),
				publish,
				confirmation,
			),
		);
		current.onDidDispose(() => {
			panelState.closed = true;
			confirmation.clear();
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
	pending: PendingRequests,
	panelState: PanelState,
	store: WorkspaceTrustStore,
	updateRecord: (
		request: Extract<TrustRequest, { root: string }>,
	) => Promise<void>,
	publish: (error?: string | null, requestId?: string) => Promise<void>,
	confirmation: TrustConfirmationState,
): (value: unknown) => void {
	/** ダイアログの待機前後で、現在のパネルが有効かを取得する。 */
	const active = () => !panelState.closed;
	return (value: unknown) => {
		const parsed = trustRequestSchema.safeParse(value);
		if (!parsed.success) {
			return;
		}
		/** 要求を直列化し、フォルダ選択の待機中に閉じた画面から信頼登録を続けない。 */
		const handleCurrentTrustRequest = async () => {
			if (!active()) {
				return;
			}
			pending.active = true;
			const request = parsed.data;
			try {
				selectTrustBackend(request, panelState);
				if (request.type !== "trust") {
					confirmation.clear();
				}
				if (request.type === "add") {
					const folders = await vscode.window.showOpenDialog({
						canSelectFiles: false,
						canSelectFolders: true,
						canSelectMany: false,
						title: "信頼設定を管理するフォルダ",
					});
					if (active() && folders?.[0]) {
						await store.registerWorkspace(
							folders[0].fsPath,
							panelState.backend,
						);
					}
				} else if (request.type !== "refresh") {
					await updateRecord(request);
				}
				await publish(null, request.requestId);
			} catch (error) {
				confirmation.clear();
				await publish(errorText(error), request.requestId);
			} finally {
				pending.active = false;
			}
		};
		pending.queue = pending.queue
			.then(handleCurrentTrustRequest)
			.catch((error: unknown) =>
				publish(errorText(error), parsed.data.requestId),
			);
	};
}

/** 画面を閉じた場合は確認待ちの操作を破棄する。 */
function createTrustRecordUpdater(
	store: WorkspaceTrustStore,
	confirmation: TrustConfirmationState,
	panelState: PanelState,
) {
	/** await の前後で閉じた状態を再取得し、古い画面の操作を続けない。 */
	const active = () => !panelState.closed;
	return async (request: Extract<TrustRequest, { root: string }>) => {
		const backend = panelState.backend;
		const records = await store.listFor(backend);
		if (!active()) {
			return;
		}
		const exists = records.some((record) => record.root === request.root);
		if (!exists) {
			throw new Error("対象の記録がありません。再読み込みしてください。");
		}
		if (request.type === "trust") {
			if (request.confirmationId === undefined) {
				await confirmation.prepare(request.root, backend);
			} else {
				await confirmation.confirm(
					request.root,
					backend,
					request.confirmationId,
					active,
				);
			}
			return;
		}
		if (request.type === "revoke") {
			await store.setBackendTrust(request.root, "untrusted", backend);
			return;
		}
		await store.setBackendTrust(request.root, "unset", backend);
	};
}

/** バックエンドの切替と、古い一覧からの変更要求の拒否をまとめる。 */
function selectTrustBackend(request: TrustRequest, state: PanelState): void {
	if (request.type === "refresh") {
		state.backend = request.backend ?? state.backend;
	}
	const mismatch =
		request.backend !== undefined && request.backend !== state.backend;
	if (mismatch) {
		throw new Error(
			"バックエンドが変更されています。再読み込みしてください。",
		);
	}
}

/** 非同期取得の世代を照合し、古い保存先や閉じたパネルへ応答しない。 */
function createTrustPublisher(
	panel: vscode.WebviewPanel,
	store: WorkspaceTrustStore,
	state: PanelState,
	piStoragePath: string,
	confirmation: TrustConfirmationState,
) {
	let revision = 0;
	return async (error: string | null = null, requestId?: string) => {
		const current = ++revision;
		const backend = state.backend;
		let records: TrustReply["records"] = [];
		try {
			if (backend === "codex") {
				for (const folder of vscode.workspace.workspaceFolders ?? []) {
					await store.registerWorkspace(folder.uri.fsPath, backend);
				}
			}
			await store.waitForChanges();
			records = (await store.listFor(backend)).sort((left, right) =>
				left.root.localeCompare(right.root),
			);
		} catch (failure) {
			error = errorText(failure);
		}
		if (!state.closed && current === revision) {
			void panel.webview.postMessage({
				type: "state",
				requestId,
				revision: current,
				confirmation: confirmation.view,
				backend,
				piStoragePath,
				records,
				error,
			} satisfies TrustReply);
		}
	};
}
