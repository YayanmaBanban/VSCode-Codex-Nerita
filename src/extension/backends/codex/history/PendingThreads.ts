// Fork成功後も一覧に現れない会話を、接続中だけサーバーの確定応答で補う。
import type { SessionSummary } from "../../../../shared/sessionHistory";
import type { HistoryThread } from "../protocol/history";

/** Codexの時刻とタイトルを共通の一覧行へ変換する。 */
export function historySummary(
	thread: HistoryThread,
	archived: boolean,
): SessionSummary {
	const date = new Date(thread.updatedAt * 1000);
	return {
		sessionId: thread.id,
		cwd: thread.cwd,
		title: thread.name?.trim() || thread.preview,
		archived,
		...(Number.isFinite(date.getTime())
			? { updatedAt: date.toISOString() }
			: {}),
	};
}
/** 本文のローカル保存はせず、一覧に反映された時点で補完情報を破棄する。 */
export class PendingThreads {
	private epoch = -1;
	private rows = new Map<string, SessionSummary>();
	/** 接続をまたいで未反映のメタデータを持ち越さない。 */
	private current(epoch: number): void {
		if (epoch !== this.epoch) {
			this.rows.clear();
			this.epoch = epoch;
		}
	}
	/** Forkの確定応答に含まれる会話だけを補完対象にする。 */
	remember(epoch: number, thread: HistoryThread): void {
		this.current(epoch);
		this.rows.set(thread.id, historySummary(thread, false));
	}
	/** アーカイブ・名前変更の成功またはサーバー通知だけを反映する。 */
	update(
		epoch: number,
		id: string,
		patch: Partial<SessionSummary> | null,
	): void {
		this.current(epoch);
		const row = this.rows.get(id);
		if (patch === null) {
			this.rows.delete(id);
		} else if (row) {
			this.rows.set(id, { ...row, ...patch });
		}
	}
	/** サーバー一覧に現れた行は補完を終え、未反映の行だけ先頭へ追加する。 */
	merge(
		epoch: number,
		archived: boolean,
		rows: SessionSummary[],
		confirmed: string[],
	): SessionSummary[] {
		this.current(epoch);
		for (const id of confirmed) {
			if (this.rows.get(id)?.archived === archived) {
				this.rows.delete(id);
			}
		}
		rows = rows.filter(
			(row) =>
				!this.rows.has(row.sessionId) ||
				this.rows.get(row.sessionId)!.archived === archived,
		);
		return [...this.rows.values()]
			.filter(
				(row) =>
					row.archived === archived &&
					!rows.some((item) => item.sessionId === row.sessionId),
			)
			.concat(rows);
	}
}
