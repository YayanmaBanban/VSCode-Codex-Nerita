// Codex の履歴一覧を作業フォルダー単位で取得し、ページと接続世代を管理する。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { isRecord } from "@nerita/shared/validation";
import { sameCwd } from "../../workspace";
import type { ChatState } from "@nerita/shared/chatState";
import type { SessionSummary } from "@nerita/shared/sessionHistory";
import type { CodexConnection } from "./runtime/connection";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { PendingThreads, historySummary } from "./history/PendingThreads";
import { threadSources } from "./history/threadSources";
import { type HistoryThread } from "./protocol/history";

/** 状態と接続の所有をセッションに残し、一覧に必要な操作だけを受け取る。 */
type CatalogSession = {
	snapshot: () => Readonly<ChatState>;
	connection: () => CodexConnection | undefined;
	epoch: () => number;
	patch: (change: Partial<ChatState>) => void;
	clearThread: () => void;
};

/** ページ取得と未反映の履歴を所有し、設定初期化・ターンの解除はセッションに委ねる。 */
export class CodexCatalog {
	private readonly pendingThreads = new PendingThreads();
	private listVersion = 0;
	private cursors = new Set<string>();
	constructor(private readonly session: CatalogSession) {}

	/** 設定初期化と接続世代の照合を終えた後、新規会話の一覧を公開する。 */
	async initialize(): Promise<void> {
		this.session.patch({
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
		await this.refresh(false);
	}
	/** 一覧操作が会話操作の後に古い結果を書き戻さないようにする。 */
	invalidate(): void {
		this.listVersion++;
		this.session.patch({
			sessionsLoading: false,
			sessionsNextCursor: null,
		});
	}
	/** 一覧の応答に反映されるまで、作成済みのフォークを保持して一覧に補う。 */
	rememberFork(epoch: number, thread: HistoryThread): void {
		this.pendingThreads.remember(epoch, thread);
	}
	/** 履歴操作の成功後にだけ、一覧未反映のメタデータを更新する。 */
	updatePendingThread(
		epoch: number,
		id: string,
		change: Partial<SessionSummary> | null,
	): void {
		this.pendingThreads.update(epoch, id, change);
	}
	/** 次ページは明示操作時だけ追加し、別フォルダーの行を除外する。 */
	async refresh(
		archived = this.session.snapshot().sessionsArchived,
		more = false,
	): Promise<void> {
		const state = this.session.snapshot();
		const client = this.session.connection();
		const cwd = state.cwd;
		if (!client || !isNonEmptyString(cwd) || state.connection !== "ready") {
			return;
		}
		if (this.cannotLoadMore(more, archived)) {
			return;
		}
		const cursor = more ? state.sessionsNextCursor! : undefined;
		const epoch = this.session.epoch();
		const version = ++this.listVersion;
		const current = () =>
			epoch === this.session.epoch() && version === this.listVersion;
		if (!more) {
			this.cursors.clear();
		}
		this.session.patch({
			sessionsLoading: true,
			sessionsError: null,
			sessionsArchived: archived,
			...(!more ? { sessions: [], sessionsNextCursor: null } : {}),
		});
		await this.loadCatalogPage(
			client,
			cwd,
			archived,
			cursor,
			current,
			more,
			epoch,
		);
	}
	/** 読み込み中やフィルター変更後の追加ページ取得を抑止する。 */
	private cannotLoadMore(more: boolean, archived: boolean) {
		const state = this.session.snapshot();
		return (
			more &&
			(state.sessionsLoading ||
				archived !== state.sessionsArchived ||
				state.sessionsNextCursor === null)
		);
	}

	/** 一覧の取得失敗と完了を同じ接続世代にだけ反映する。 */
	private async loadCatalogPage(
		client: CodexConnection,
		cwd: string,
		archived: boolean,
		cursor: string | undefined,
		current: () => boolean,
		more: boolean,
		epoch: number,
	): Promise<void> {
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

			this.applyCatalogPage(page, cursor, more, cwd, archived, epoch);
		} catch {
			if (current()) {
				this.session.patch({
					sessionsError:
						"履歴を取得できませんでした。再試行してください。",
				});
			}
		} finally {
			if (current()) {
				this.session.patch({ sessionsLoading: false });
			}
		}
	}
	/** カーソルの循環を検出し、同じ作業フォルダーの履歴を統合する。 */
	private applyCatalogPage(
		page: { data: HistoryThread[]; nextCursor: string | null },
		cursor: string | undefined,
		more: boolean,
		cwd: string,
		archived: boolean,
		epoch: number,
	) {
		if (
			page.nextCursor !== null &&
			(page.nextCursor === cursor || this.cursors.has(page.nextCursor))
		) {
			throw new Error("Repeated catalog cursor");
		}

		if (cursor !== undefined) {
			this.cursors.add(cursor);
		}

		const rows = new Map(
			(more ? this.session.snapshot().sessions : []).map((row) => [
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

		this.session.patch({
			sessions: this.pendingThreads.merge(
				epoch,
				archived,
				[...rows.values()],
				page.data.map((thread) => thread.id),
			),
			sessionsNextCursor: page.nextCursor,
		});
	}

	/** 別クライアントによる名前変更や保存完了も次の一覧に反映する。 */
	notification(message: AppServerNotification): void {
		this.updateCatalogNotification(message);
		const state = this.session.snapshot();
		if (
			isRecord(message.params) &&
			[
				"thread/name/updated",
				"thread/archived",
				"thread/unarchived",
				"thread/deleted",
				"turn/completed",
			].includes(message.method) &&
			state.connection === "ready" &&
			!state.sessionPending
		) {
			if (
				["thread/archived", "thread/deleted"].includes(
					message.method,
				) &&
				message.params.threadId === state.sessionId
			) {
				this.session.clearThread();
			}
			void this.refresh();
		}
	}

	/** 履歴の名前とアーカイブ状態を通知から更新する。 */
	private updateCatalogNotification(message: AppServerNotification) {
		if (
			isRecord(message.params) &&
			typeof message.params.threadId === "string"
		) {
			const id = message.params.threadId;
			if (
				message.method === "thread/archived" ||
				message.method === "thread/unarchived"
			) {
				this.pendingThreads.update(this.session.epoch(), id, {
					archived: message.method === "thread/archived",
				});
			} else if (message.method === "thread/deleted") {
				this.pendingThreads.update(this.session.epoch(), id, null);
			} else if (
				message.method === "thread/name/updated" &&
				typeof message.params.threadName === "string"
			) {
				this.pendingThreads.update(this.session.epoch(), id, {
					title: message.params.threadName,
				});
				if (id === this.session.snapshot().sessionId) {
					this.session.patch({
						sessionTitle:
							nonEmptyString(message.params.threadName.trim()) ??
							null,
					});
				}
			}
		}
	}
}
