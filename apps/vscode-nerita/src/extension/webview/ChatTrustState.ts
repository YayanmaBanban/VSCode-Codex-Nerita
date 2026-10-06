// 会話の作業ルートに対する信頼状態を、会話本文とは独立して Webview へ通知する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import * as vscode from "vscode";
import type { HostMessage } from "@nerita/shared/messages";
import type { ChatSession } from "../session/chatSession";
import type { WorkspaceTrustStore } from "../security/trust/WorkspaceTrustStore";
import { configuredBackend } from "./backendSettings";

/** 信頼・作業ルート・バックエンドの変更を追跡し、古い非同期結果を破棄する。 */
export class ChatTrustState {
	private revision = 0;
	private cwd: string | null;
	private readonly subscriptions: vscode.Disposable[];

	constructor(
		private readonly session: ChatSession,
		private readonly store: WorkspaceTrustStore | undefined,
		private readonly publish: (message: HostMessage) => void,
	) {
		this.cwd = session.snapshot().cwd;
		this.subscriptions = [
			{
				dispose: session.subscribe(() => {
					const cwd = session.snapshot().cwd;
					if (cwd !== this.cwd) {
						this.cwd = cwd;
						void this.refresh();
					}
				}),
			},
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("nerita.backend")) {
					void this.refresh();
				}
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				void this.refresh();
			}),
			vscode.workspace.onDidGrantWorkspaceTrust(() => {
				void this.refresh();
			}),
		];
		if (store) {
			this.subscriptions.push({
				dispose: store.onChange(() => {
					void this.refresh();
				}),
			});
		}
	}

	/** 初期表示でも現在のルートを評価し、未接続時は先頭のワークスペースを使う。 */
	async refresh(): Promise<void> {
		const revision = ++this.revision;
		const cwd =
			this.session.snapshot().cwd ??
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const untrusted =
			configuredBackend() === "pi" &&
			isNonEmptyString(cwd) &&
			!(
				vscode.workspace.isTrusted &&
				(await this.store?.trusted(cwd)) === true
			);
		if (revision === this.revision) {
			this.publish({ type: "workspace/trustState", untrusted });
		}
	}

	/** 破棄後に進行中の照合結果を通知しない。 */
	dispose(): void {
		this.revision++;
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
	}
}
