// 審査の表示記録を Pi のカスタム履歴へ保存し、同じ形で実行中と復元後に表示する。
import type {
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ChatState, ToolSummary } from "@nerita/shared/chatState";
import {
	autoReviewRecordSchema,
	type AutoReviewRecord,
} from "@nerita/shared/guardrails/review";
import { nextTimelineOrder } from "../../session/timelineOrder";

const customType = "nerita.auto-review.v1";

/** 保存データはモデル入力に含めず、購読者へは表示用レコードだけを通知する。 */
export class PiReviewHistory {
	private readonly listeners = new Set<(record: AutoReviewRecord) => void>();
	private closed = false;
	/** エージェントの会話を追加する API は受け取らず、カスタム保存だけを許可する。 */
	constructor(
		private readonly manager: Pick<SessionManager, "appendCustomEntry">,
	) {}
	/** 開始と終了を同じ ID で保存し、モデルの会話や実行許可へは戻さない。 */
	publish(record: AutoReviewRecord) {
		if (this.closed) {
			return;
		}
		const value = autoReviewRecordSchema.parse(record);
		this.manager.appendCustomEntry(customType, structuredClone(value));
		for (const listener of this.listeners) {
			listener(value);
		}
	}
	/** 実行の購読期間だけ通知し、次の会話へ遅い結果を渡さない。 */
	subscribe(listener: (record: AutoReviewRecord) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 破棄後の遅い判定を保存・通知しない。途中の審査は復元時に中断へ戻す。 */
	dispose() {
		this.closed = true;
		this.listeners.clear();
	}
}

/** Codex の `GuardianReview` と同じ表示契約へ変換し、表示順と審査 ID を維持する。 */
export function mapPiReview(
	record: AutoReviewRecord,
	state: ChatState,
	restored = false,
): Partial<ChatState> {
	const id = `autoApprovalReview:${record.id}`;
	const existing = state.tools.find((tool) => tool.id === id);
	const interrupted = restored && record.status === "reviewing";
	const status = interrupted ? "cancelled" : record.status;
	const tool: ToolSummary = {
		id,
		title: "Guardian Review",
		kind: "think",
		paths: [],
		...(state.runId === null ? {} : { runId: state.runId }),
		cwd: record.action.cwd,
		order: existing?.order ?? nextTimelineOrder(state),
		status: reviewToolStatus(status),
		rawOutput: reviewOutput(record, status, interrupted),
	};
	if (!existing) {
		return { tools: [...state.tools, tool] };
	}
	return {
		tools: state.tools.map((item) => {
			if (item === existing) {
				return tool;
			}
			return item;
		}),
	};
}

/** `GuardianReview` の構造化表示へ変換し、モデルと所要時間も復元する。 */
function reviewOutput(
	record: AutoReviewRecord,
	status: AutoReviewRecord["status"],
	interrupted: boolean,
) {
	return {
		action: record.action,
		review: {
			id: record.id,
			status: {
				reviewing: "inProgress",
				approved: "approved",
				denied: "denied",
				manual: "needsApproval",
				unavailable: "failed",
				timedOut: "timedOut",
				cancelled: "aborted",
			}[status],
			riskLevel: record.risk ?? null,
			userAuthorization: record.authorization ?? null,
			rationale: interrupted
				? "前回の審査は完了していません。"
				: record.reason,
			model: record.model,
			durationMs: record.durationMs,
			reviewDurationMs: record.reviewDurationMs ?? null,
			source: record.source ?? null,
			reusedFrom: record.reusedFrom ?? null,
			prefetched: record.prefetched ?? false,
			metrics: record.metrics ?? null,
		},
	};
}

/** 中断された審査は自動再実行せず、履歴の選択ブランチ内だけで復元する。 */
export function restorePiReview(
	entry: SessionEntry,
	state: ChatState,
): boolean {
	if (entry.type !== "custom" || entry.customType !== customType) {
		return false;
	}
	const parsed = autoReviewRecordSchema.safeParse(entry.data);
	if (!parsed.success) {
		throw new Error("Pi の自動レビュー履歴が破損しています。");
	}
	Object.assign(state, mapPiReview(parsed.data, state, true));
	return true;
}

/** 審査が完了して手動確認へ移った場合は、審査カードを実行中のまま残さない。 */
function reviewToolStatus(
	status: AutoReviewRecord["status"],
): ToolSummary["status"] {
	if (status === "reviewing") {
		return "in_progress";
	}
	if (status === "approved" || status === "manual") {
		return "completed";
	}
	return status === "cancelled" ? "cancelled" : "failed";
}
