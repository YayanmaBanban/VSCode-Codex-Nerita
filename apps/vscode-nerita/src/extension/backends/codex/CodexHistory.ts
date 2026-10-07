// Codex に保存された履歴を操作し、復元が成功するまで現在の会話を保持する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { sameCwd } from "../../workspace";
import type { CodexCatalog } from "./CodexCatalog";
import type { ChatState } from "@nerita/shared/chatState";
import { restoreDisplayHistory } from "./history/restoreHistory";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { isRecord } from "@nerita/shared/validation";
import { type CodexConnection } from "./runtime/connection";
import type { HistoryThread } from "./protocol/history";
import { type SessionSummary } from "@nerita/shared/sessionHistory";

/** 本文と全文出力は復元完了まで履歴操作側が保持し、反映時にコントローラーへ引き渡す。 */
export type RestoredHistory = {
	result: Awaited<ReturnType<CodexConnection["resumeThread"]>>;
	display: Awaited<ReturnType<typeof restoreDisplayHistory>>;
};

/** 会話状態の管理と切り替えはコントローラーへ委ね、現在値の取得と復元結果の反映に使う操作を受け取る。 */
type HistorySession = {
	snapshot: () => Readonly<ChatState>;
	connection: () => CodexConnection | undefined;
	epoch: () => number;
	busy: () => boolean;
	patch: (change: Partial<ChatState>) => void;
	clearThread: () => void;
	/** 呼出し時に全文出力を引き取り、反映できない場合も破棄する。 */
	restoreThread: (
		restored: RestoredHistory,
		current: () => boolean,
	) => Promise<void>;
};

/** 切断前の処理が新しい操作の復元判定や待機状態を解除しないよう、操作を識別する。 */
type HistoryOperation = {
	epoch: number;
	restoring?: { id: string; changed: boolean };
};

type HistoryAction =
	"load" | "fork" | "delete" | "archive" | "rename" | "unarchive";

/** アーカイブと恒久削除を区別し、成功後に一覧と現在の会話を更新する。 */
export class CodexHistory {
	private operation: HistoryOperation | undefined;
	constructor(
		private readonly session: HistorySession,
		private readonly catalog: CodexCatalog,
	) {}

	/** 同じ接続でも、別の履歴操作へ後片付けや取得結果を持ち越さない。 */
	private current(operation: HistoryOperation): boolean {
		return (
			this.operation === operation &&
			operation.epoch === this.session.epoch()
		);
	}
	/** 実行中の変更と履歴操作の権限を照合する。 */
	private historyUnavailable(action: HistoryAction): boolean {
		const state = this.session.snapshot();
		return (
			this.session.busy() ||
			state.sessionPending ||
			state.attachmentPending ||
			state.configPending ||
			!(state.sessionCapabilities[action] === true)
		);
	}
	/** 復元中に別クライアントが会話を進めた場合は、不完全な本文を公開しない。 */
	notification(message: AppServerNotification): void {
		const operation = this.operation;
		const restoring = operation?.restoring;
		if (
			operation &&
			this.current(operation) &&
			restoring &&
			isRecord(message.params) &&
			message.params.threadId === restoring.id &&
			["turn/started", "thread/archived", "thread/deleted"].includes(
				message.method,
			)
		) {
			restoring.changed = true;
		}
	}
	/** 表示済みの同一フォルダーの履歴だけを、実行していない間に操作する。 */
	async manage(
		action: HistoryAction,
		threadId: string,
		name?: string,
	): Promise<void> {
		const state = this.session.snapshot();
		const client = this.session.connection();
		const cwd = state.cwd;
		const row = state.sessions.find((item) => item.sessionId === threadId);
		if (
			!client ||
			!isNonEmptyString(cwd) ||
			!row ||
			!sameCwd(row.cwd, cwd) ||
			this.historyUnavailable(action)
		) {
			throw new Error("History unavailable");
		}
		validateHistoryAction(row, action, name);
		if (action === "load" && threadId === state.sessionId) {
			return;
		}
		const operation: HistoryOperation = { epoch: this.session.epoch() };
		if (["load", "fork"].includes(action)) {
			operation.restoring = { id: threadId, changed: false };
		}
		this.operation = operation;
		const current = () => this.current(operation);
		this.catalog.invalidate();
		this.session.patch({ sessionPending: true, sessionsError: null });
		let error: string | null = null;
		try {
			await this.performHistoryAction(
				client,
				cwd,
				action,
				threadId,
				name,
				operation,
				current,
			);
		} catch {
			error =
				"履歴を更新できませんでした。別の画面で実行中でないことを確認して再試行してください。";
		} finally {
			await this.finishHistoryAction(operation, error);
		}
	}

	/** 履歴の一覧更新後に操作待ちと復元状態を解除する。 */
	private async finishHistoryAction(
		operation: HistoryOperation,
		error: string | null,
	) {
		try {
			if (!this.current(operation)) {
				return;
			}
			await this.catalog.refresh();
			if (this.current(operation)) {
				this.session.patch({
					sessionPending: false,
					...(isNonEmptyString(error)
						? { sessionsError: error }
						: {}),
				});
			}
		} finally {
			if (this.operation === operation) {
				this.operation = undefined;
			}
		}
	}

	/** 削除とアーカイブを区別して一覧と現在の会話を更新する。 */
	private async removeHistoryThread(
		action: "delete" | "archive",
		client: CodexConnection,
		threadId: string,
		current: () => boolean,
		epoch: number,
	) {
		if (action === "delete") {
			await client.deleteThread(threadId);
		} else {
			await client.archiveThread(threadId);
		}
		if (current()) {
			this.catalog.updatePendingThread(
				epoch,
				threadId,
				action === "delete" ? null : { archived: true },
			);
		}
		if (current() && this.session.snapshot().sessionId === threadId) {
			this.session.clearThread();
		}
	}

	/** 会話名の変更を現在の接続と表示へ反映する。 */
	private async renameHistoryThread(
		client: CodexConnection,
		threadId: string,
		name: string | undefined,
		current: () => boolean,
		epoch: number,
	) {
		await client.renameThread(threadId, name!.trim());
		if (current()) {
			this.catalog.updatePendingThread(epoch, threadId, {
				title: name!.trim(),
			});
			if (this.session.snapshot().sessionId === threadId) {
				this.session.patch({ sessionTitle: name!.trim() });
			}
		}
	}

	/** 履歴を復元する。復元中に本文が更新された場合は、取得した結果を公開しない。 */
	private async restoreHistoryThread(
		client: CodexConnection,
		thread: HistoryThread,
		action: "load" | "fork",
		threadId: string,
		cwd: string,
		operation: HistoryOperation,
		current: () => boolean,
	): Promise<void> {
		// 読み込みとフォークでは、対象の確認前から復元対象の変更を追跡する。
		const restoring = operation.restoring!;
		if (restoring.changed) {
			throw new Error("History changed before restore");
		}
		const result =
			action === "fork"
				? await client.forkThread(
						threadId,
						thread.historyMode === "paginated",
					)
				: await client.resumeThread(
						threadId,
						thread.historyMode === "paginated",
					);
		if (!current()) {
			return;
		}
		validateRestoredThread(result, cwd, action, threadId);
		if (action === "fork") {
			this.catalog.rememberFork(operation.epoch, result.thread);
		}
		restoring.id = result.thread.id;
		const display = await restoreDisplayHistory(
			client,
			result.thread,
			() => current() && !restoring.changed,
		);
		if (!current()) {
			display.outputs.dispose();
			return;
		}
		// 履歴取得を待つ間に通知が変更フラグを書き換えるため、取得後にも確認する。
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (restoring.changed) {
			display.outputs.dispose();
			throw new Error("History changed during restore");
		}
		await this.session.restoreThread({ result, display }, current);
	}

	/** 対象スレッドを再確認して履歴操作をサーバーへ送る。 */
	private async performHistoryAction(
		client: CodexConnection,
		cwd: string,
		action: HistoryAction,
		threadId: string,
		name: string | undefined,
		operation: HistoryOperation,
		current: () => boolean,
	): Promise<void> {
		const { thread } = await client.readThread(threadId);
		if (!current()) {
			return;
		}
		if (
			thread.id !== threadId ||
			!sameCwd(thread.cwd, cwd) ||
			thread.active
		) {
			throw new Error("Thread unavailable");
		}
		if (action === "rename") {
			await this.renameHistoryThread(
				client,
				threadId,
				name,
				current,
				operation.epoch,
			);
		} else if (action === "unarchive") {
			await client.unarchiveThread(threadId);
			if (current()) {
				this.catalog.updatePendingThread(operation.epoch, threadId, {
					archived: false,
				});
			}
		} else if (action === "delete" || action === "archive") {
			await this.removeHistoryThread(
				action,
				client,
				threadId,
				current,
				operation.epoch,
			);
		} else {
			await this.restoreHistoryThread(
				client,
				thread,
				action,
				threadId,
				cwd,
				operation,
				current,
			);
		}
	}
}

/** 復元したスレッドの作業場所と識別子を照合する。 */
function validateRestoredThread(
	result: Awaited<ReturnType<CodexConnection["resumeThread"]>>,
	cwd: string,
	action: string,
	threadId: string,
) {
	if (
		!sameCwd(result.cwd, cwd) ||
		!sameCwd(result.thread.cwd, cwd) ||
		result.thread.active ||
		(action === "load" && result.thread.id !== threadId)
	) {
		throw new Error("Unexpected restored thread");
	}
}

/** アーカイブ状態と会話名に応じて履歴操作を検証する。 */
function validateHistoryAction(
	row: SessionSummary,
	action: string,
	name: string | undefined,
) {
	if (
		row.archived === true
			? !["unarchive", "delete"].includes(action)
			: action === "unarchive"
	) {
		throw new Error("Invalid archive action");
	}
	if (
		action === "rename" &&
		(!isNonEmptyString(name?.trim()) || name.trim().length > 200)
	) {
		throw new Error("Invalid name");
	}
}
