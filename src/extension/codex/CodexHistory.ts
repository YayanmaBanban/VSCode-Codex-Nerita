// 履歴操作はCodexを正とし、復元の成功まで現在の会話を保持する。
import { sameCwd } from "../workspace";
import { CodexCatalog } from "./CodexCatalog";
import { hydrateHistory, replayHistory } from "./restoreHistory";
import type { AppServerNotification } from "./rpcMessage";
import { isRecord } from "../../shared/validation";

/** アーカイブは可逆操作として扱い、恒久削除APIを公開しない。 */
export abstract class CodexHistory extends CodexCatalog {
	private restoring: { id: string; changed: boolean } | undefined;
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
		action: "load" | "fork" | "delete" | "rename" | "unarchive",
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
			this.busy() ||
			this.state.sessionPending ||
			this.state.attachmentPending ||
			this.state.configPending ||
			!this.state.sessionCapabilities[action]
		) {
			throw new Error("History unavailable");
		}
		if (row.archived ? action !== "unarchive" : action === "unarchive") {
			throw new Error("Invalid archive action");
		}
		if (
			action === "rename" &&
			(!name?.trim() || name.trim().length > 200)
		) {
			throw new Error("Invalid name");
		}
		if (action === "load" && threadId === this.state.sessionId) {
			return;
		}
		const epoch = this.epoch;
		const current = () => epoch === this.epoch;
		this.invalidateCatalog();
		this.patch({ sessionPending: true, sessionsError: null });
		let error: string | null = null;
		try {
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
				await client.renameThread(threadId, name!.trim());
				if (current()) {
					this.pendingThreads.update(epoch, threadId, {
						title: name!.trim(),
					});
				}
			} else if (action === "unarchive") {
				await client.unarchiveThread(threadId);
				if (current()) {
					this.pendingThreads.update(epoch, threadId, {
						archived: false,
					});
				}
			} else if (action === "delete") {
				await client.archiveThread(threadId);
				if (current()) {
					this.pendingThreads.update(epoch, threadId, {
						archived: true,
					});
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
			} else {
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
				if (
					!sameCwd(result.cwd, cwd) ||
					!sameCwd(result.thread.cwd, cwd) ||
					result.thread.active ||
					(action === "load" && result.thread.id !== threadId)
				) {
					throw new Error("Unexpected restored thread");
				}
				if (action === "fork") {
					this.pendingThreads.remember(epoch, result.thread);
				}
				restoring.id = result.thread.id;
				const turns = await hydrateHistory(
					client,
					result.thread,
					() => current() && !restoring.changed,
				);
				const restored = replayHistory(turns);
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
			}
		} catch {
			error =
				"履歴を更新できませんでした。別の画面で実行中でないことを確認して再試行してください。";
		} finally {
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
	}
}
