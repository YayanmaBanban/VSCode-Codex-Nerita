// 履歴操作は Codex を正とし、復元の成功まで現在の会話を保持する。
import { sameCwd } from "../../workspace";
import { CodexCatalog } from "./CodexCatalog";
import { hydrateHistory, replayHistory } from "./history/restoreHistory";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { isRecord } from "../../../shared/validation";
import { type CodexConnection } from "./runtime/connection";
import type { HistoryThread } from "./protocol/history";
import { type SessionSummary } from "@/shared/sessionHistory";

/** アーカイブと恒久削除を区別し、成功後に一覧と現在の会話を更新する。 */
export abstract class CodexHistory extends CodexCatalog {
	private restoring: { id: string; changed: boolean } | undefined;
	/** 実行中の変更と履歴操作の権限を照合する。 */
	private historyUnavailable(
		action: "load" | "fork" | "delete" | "archive" | "rename" | "unarchive",
	): boolean {
		return (
			this.busy() ||
			this.state.sessionPending ||
			this.state.attachmentPending ||
			this.state.configPending ||
			!this.state.sessionCapabilities[action]
		);
	}
	/** 復元中に別クライアントが会話を進めた場合は、不完全な本文を公開しない。 */
	protected override notification(message: AppServerNotification): void {
		if (
			this.restoring &&
			isRecord(message.params) &&
			message.params.threadId === this.restoring.id &&
			["turn/started", "thread/archived", "thread/deleted"].includes(
				message.method,
			)
		) {
			this.restoring.changed = true;
		}
		super.notification(message);
	}
	/** 表示済みの同一フォルダーの履歴だけを、実行していない間に操作する。 */
	protected async manageHistory(
		action: "load" | "fork" | "delete" | "archive" | "rename" | "unarchive",
		threadId: string,
		name?: string,
	): Promise<void> {
		const client = this.client;
		const cwd = this.state.cwd;
		const row = this.state.sessions.find(
			(item) => item.sessionId === threadId,
		);
		if (
			!client ||
			!cwd ||
			!row ||
			!sameCwd(row.cwd, cwd) ||
			this.historyUnavailable(action)
		) {
			throw new Error("History unavailable");
		}
		validateHistoryAction(row, action, name);
		if (action === "load" && threadId === this.state.sessionId) {
			return;
		}
		const epoch = this.epoch;
		const current = () => epoch === this.epoch;
		this.invalidateCatalog();
		this.patch({ sessionPending: true, sessionsError: null });
		let error: string | null = null;
		try {
			await this.performHistoryAction(
				client,
				cwd,
				action,
				threadId,
				name,
				epoch,
				current,
			);
		} catch {
			error =
				"履歴を更新できませんでした。別の画面で実行中でないことを確認して再試行してください。";
		} finally {
			await this.finishHistoryAction(current, error);
		}
	}

	/** 履歴の一覧更新後に操作待ちと復元状態を解除する。 */
	private async finishHistoryAction(
		current: () => boolean,
		error: string | null,
	) {
		if (current()) {
			await this.refreshSessions();
			if (current()) {
				this.restoring = undefined;
				this.patch({
					sessionPending: false,
					...(error ? { sessionsError: error } : {}),
				});
			}
		}
	}

	/** 削除とアーカイブを区別して一覧と現在の会話を更新する。 */
	private async removeHistoryThread(
		action: string,
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
			this.pendingThreads.update(
				epoch,
				threadId,
				action === "delete" ? null : { archived: true },
			);
		}
		if (current() && this.state.sessionId === threadId) {
			this.resetRun();
			this.patch({
				sessionId: null,
				runId: null,
				run: "idle",
				messages: [],
				tools: [],
				permissions: [],
				asyncTasks: [],
				attachments: [],
				usage: null,
				configOptions: [],
			});
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
			this.pendingThreads.update(epoch, threadId, {
				title: name!.trim(),
			});
			if (this.state.sessionId === threadId) {
				this.patch({ sessionTitle: name!.trim() });
			}
		}
	}

	/** 履歴を復元し、復元中に更新された本文を公開しない。 */
	private async restoreHistoryThread(
		client: CodexConnection,
		thread: HistoryThread,
		action: "load" | "fork",
		threadId: string,
		cwd: string,
		epoch: number,
		current: () => boolean,
	): Promise<void> {
		const restoring = { id: threadId, changed: false };
		this.restoring = restoring;
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
			this.pendingThreads.remember(epoch, result.thread);
		}
		restoring.id = result.thread.id;
		const turns = await hydrateHistory(
			client,
			result.thread,
			() => current() && !restoring.changed,
		);
		const restored = replayHistory(turns, result.thread.id);
		if (!current()) {
			return;
		}
		if (restoring.changed) {
			throw new Error("History changed during restore");
		}
		this.resetRun();
		this.patch({
			...restored,
			sessionId: result.thread.id,
			sessionTitle:
				result.thread.name?.trim() || result.thread.preview || null,
			runId: null,
			run: "idle",
			permissions: [],
			asyncTasks: [],
			attachments: [],
			usage: null,
			configOptions: [],
			error: null,
		});
		await this.restoreThreadOptions(result);
		this.synchronizeAgents();
	}

	/** 対象スレッドを再確認して履歴操作をサーバーへ送る。 */
	private async performHistoryAction(
		client: CodexConnection,
		cwd: string,
		action: "load" | "fork" | "delete" | "archive" | "rename" | "unarchive",
		threadId: string,
		name: string | undefined,
		epoch: number,
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
				epoch,
			);
		} else if (action === "unarchive") {
			await client.unarchiveThread(threadId);
			if (current()) {
				this.pendingThreads.update(epoch, threadId, {
					archived: false,
				});
			}
		} else if (action === "delete" || action === "archive") {
			await this.removeHistoryThread(
				action,
				client,
				threadId,
				current,
				epoch,
			);
		} else {
			await this.restoreHistoryThread(
				client,
				thread,
				action,
				threadId,
				cwd,
				epoch,
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
		row.archived
			? !["unarchive", "delete"].includes(action)
			: action === "unarchive"
	) {
		throw new Error("Invalid archive action");
	}
	if (action === "rename" && (!name?.trim() || name.trim().length > 200)) {
		throw new Error("Invalid name");
	}
}
