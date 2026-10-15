// 信頼の確認対象を Host 内に保持し、Webview の確定操作と実体の照合を結び付ける。
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { BackendId } from "@nerita/shared/backend";
import type { TrustConfirmation } from "@nerita/shared/workspaceTrust";
import { canonicalPath } from "../WorkspacePathPolicy";
import { containsPath } from "../AgentAccessPolicy";
import type { WorkspaceTrustStore, TrustRecord } from "./WorkspaceTrustStore";

/** 確認したフォルダを一度だけ信頼済みに変更し、別の操作やパネル終了時には確認情報を破棄する。 */
export class TrustConfirmationState {
	private pending:
		| {
				view: TrustConfirmation;
				identity: TrustRecord["identity"];
		  }
		| undefined;
	/** 保存処理は実行許可を所有する既存のストアへ委譲する。 */
	constructor(private readonly store: WorkspaceTrustStore) {}
	/** ファイルの識別情報は Host 内に保持し、確認 ID と表示情報を返す。 */
	get view(): TrustConfirmation | null {
		return this.pending?.view ?? null;
	}
	/** 他の要求へ移ると、古い確認画面からの確定は無効になる。 */
	clear(): void {
		this.pending = undefined;
	}
	/** ユーザーが一覧で選んだキーを保持し、確定時の対象照合に使う。 */
	async prepare(root: string, backend: BackendId): Promise<void> {
		this.clear();
		this.requireWorkspaceTrust();
		const canonical = await canonicalPath(root, process.cwd());
		const info = await stat(canonical);
		if (!info.isDirectory()) {
			throw new Error("信頼する対象にはフォルダを指定してください。");
		}
		const external =
			backend === "pi" &&
			this.store
				.list()
				.some(
					(record) =>
						record.origin !== "workspace" &&
						containsPath(record.root, canonical),
				);
		this.pending = {
			view: { id: randomUUID(), root, canonical, external, backend },
			identity: {
				dev: info.dev,
				ino: info.ino,
				birthtimeMs: info.birthtimeMs,
			},
		};
	}
	/** 一覧の対象・バックエンド・実体が確認時と一致する場合だけ保存する。 */
	async confirm(
		root: string,
		backend: BackendId,
		id: string,
		active: () => boolean,
	): Promise<void> {
		const pending = this.pending;
		this.clear();
		const matches =
			pending?.view.id === id &&
			pending.view.root === root &&
			pending.view.backend === backend;
		if (!matches || !active()) {
			throw new Error(
				"信頼の確認が無効になりました。もう一度操作してください。",
			);
		}
		this.requireWorkspaceTrust();
		const canonical = await canonicalPath(root, process.cwd());
		if (canonical !== pending.view.canonical || !active()) {
			throw new Error(
				"確認中に対象が変更されました。もう一度操作してください。",
			);
		}
		await this.store.setBackendTrust(
			root,
			"trusted",
			backend,
			pending.identity,
		);
	}
	/** VS Code の制限モードでも、確認 UI だけで実行を許可しない。 */
	private requireWorkspaceTrust(): void {
		if (!vscode.workspace.isTrusted) {
			throw new Error(
				"VS Code の制限モードを解除してから再試行してください。",
			);
		}
	}
}
