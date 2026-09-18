// Codexの履歴一覧を作業フォルダー単位で取得し、ページと接続世代を管理する。
import { isRecord } from "../../shared/validation";
import { sameCwd } from "../workspace";
import { CodexRun } from "./CodexRun";
import type { StartedThread } from "./turnProtocol";
import type { AppServerNotification } from "./rpcMessage";
import { PendingThreads, historySummary } from "./PendingThreads";
import { threadSources } from "./threadSources";

/** 新規会話と履歴復元で同じ一覧機能を公開する。 */
export abstract class CodexCatalog extends CodexRun {
	protected pendingThreads = new PendingThreads();
	private listVersion = 0;
	private cursors = new Set<string>();
	/** 復元では一覧のフィルターを保って設定だけを更新する。 */
	protected restoreThreadOptions(thread: StartedThread): Promise<void> {
		return super.initializedThread(thread);
	}
	/** 新規接続時から履歴機能を利用可能にする。 */
	protected override async initializedThread(
		thread: StartedThread,
	): Promise<void> {
		const epoch = this.epoch;
		await super.initializedThread(thread);
		if (epoch !== this.epoch) {
			return;
		}
		this.patch({
			sessionCapabilities: {
				list: true,
				load: true,
				fork: true,
				delete: true,
				archive: true,
				rename: true,
				unarchive: true,
			},
		});
		await this.refreshSessions(false);
	}
	/** 一覧操作が会話操作の後に古い結果を書き戻さないようにする。 */
	protected invalidateCatalog(): void {
		this.listVersion++;
		this.patch({ sessionsLoading: false, sessionsNextCursor: null });
	}
	/** 次ページは明示操作時だけ追加し、別フォルダーの行を除外する。 */
	protected async refreshSessions(
		archived = this.state.sessionsArchived,
		more = false,
	): Promise<void> {
		const client = this.client;
		const cwd = this.state.cwd;
		if (!client || !cwd || this.state.connection !== "ready") {
			return;
		}
		if (
			more &&
			(this.state.sessionsLoading ||
				archived !== this.state.sessionsArchived ||
				this.state.sessionsNextCursor === null)
		) {
			return;
		}
		const cursor = more ? this.state.sessionsNextCursor! : undefined;
		const epoch = this.epoch;
		const version = ++this.listVersion;
		const current = () =>
			epoch === this.epoch && version === this.listVersion;
		if (!more) {
			this.cursors.clear();
		}
		this.patch({
			sessionsLoading: true,
			sessionsError: null,
			sessionsArchived: archived,
			...(!more ? { sessions: [], sessionsNextCursor: null } : {}),
		});
		try {
			const page = await client.listThreads({
				cwd,
				archived,
				limit: 50,
				sortKey: "updated_at",
				sortDirection: "desc",
				modelProviders: [],
				sourceKinds: threadSources,
				...(cursor !== undefined ? { cursor } : {}),
			});
			if (!current()) {
				return;
			}
			if (
				page.nextCursor !== null &&
				(page.nextCursor === cursor ||
					this.cursors.has(page.nextCursor))
			) {
				throw new Error("Repeated catalog cursor");
			}
			if (cursor !== undefined) {
				this.cursors.add(cursor);
			}
			const rows = new Map(
				(more ? this.state.sessions : []).map((row) => [
					row.sessionId,
					row,
				]),
			);
			for (const thread of page.data) {
				if (!sameCwd(thread.cwd, cwd)) {
					continue;
				}
				rows.set(thread.id, historySummary(thread, archived));
			}
			this.patch({
				sessions: this.pendingThreads.merge(
					epoch,
					archived,
					[...rows.values()],
					page.data.map((thread) => thread.id),
				),
				sessionsNextCursor: page.nextCursor,
			});
		} catch {
			if (current()) {
				this.patch({
					sessionsError:
						"履歴を取得できませんでした。再試行してください。",
				});
			}
		} finally {
			if (current()) {
				this.patch({ sessionsLoading: false });
			}
		}
	}
	/** 別クライアントによる名前変更や保存完了も次の一覧に反映する。 */
	protected override notification(message: AppServerNotification): void {
		super.notification(message);
		if (
			isRecord(message.params) &&
			typeof message.params.threadId === "string"
		) {
			const id = message.params.threadId;
			if (
				message.method === "thread/archived" ||
				message.method === "thread/unarchived"
			) {
				this.pendingThreads.update(this.epoch, id, {
					archived: message.method === "thread/archived",
				});
			} else if (message.method === "thread/deleted") {
				this.pendingThreads.update(this.epoch, id, null);
			} else if (
				message.method === "thread/name/updated" &&
				typeof message.params.threadName === "string"
			) {
				this.pendingThreads.update(this.epoch, id, {
					title: message.params.threadName,
				});
				if (id === this.state.sessionId) {
					this.patch({
						sessionTitle: message.params.threadName.trim() || null,
					});
				}
			}
		}
		if (
			isRecord(message.params) &&
			[
				"thread/name/updated",
				"thread/archived",
				"thread/unarchived",
				"thread/deleted",
				"turn/completed",
			].includes(message.method) &&
			this.state.connection === "ready" &&
			!this.state.sessionPending
		) {
			if (
				["thread/archived", "thread/deleted"].includes(
					message.method,
				) &&
				message.params.threadId === this.state.sessionId
			) {
				this.resetRun();
				this.patch({
					sessionId: null,
					runId: null,
					run: "idle",
					permissions: [],
					attachments: [],
					configOptions: [],
					usage: null,
				});
			}
			void this.refreshSessions();
		}
	}
}
