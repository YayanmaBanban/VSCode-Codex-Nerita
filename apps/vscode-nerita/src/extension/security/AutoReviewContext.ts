// 作業エージェントから変更できない、Host 登録のレビュー実行先と親会話を参照する。
import type { AutoReviewConfig } from "@nerita/shared/agentManager/autoReview";
import type { ToolCall } from "./ApprovedToolCall";
import type { AutoReviewRecord } from "@nerita/shared/guardrails/review";
import { AutoReviewCache } from "./AutoReviewCache";

/** 会話の出所を維持し、子のタスクやツール出力をユーザー承認へ昇格させない。 */
export type ReviewEvidence = {
	role: "user" | "assistant" | "tool";
	text: string;
};
/** モデルの接続と認証は Pi の Runtime が所有し、共通ガードには公開しない。 */
export type AutoReviewContext = {
	cache: AutoReviewCache;
	signal: AbortSignal;
	root: string;
	evidence: () => ReviewEvidence[];
	protect: (text: string) => string;
	/** 発行元のセッションだけが表示と保存を所有する。 */
	publish?: (record: AutoReviewRecord) => void;
	review: (
		config: AutoReviewConfig,
		input: string,
		signal: AbortSignal,
	) => Promise<unknown>;
};
const contexts = new Map<string, AutoReviewContext>();

/** 子は親の信頼 ID を共有し、レビュー先や承認根拠を上書きできない。 */
export function bindAutoReviewContext(
	id: string,
	context: Omit<AutoReviewContext, "cache" | "signal">,
) {
	if (contexts.has(id)) {
		return {
			attached: false,
			dispose: () => {},
			invalidate: (_cancelPermits = true) => {},
		};
	}
	let abort = new AbortController();
	const bound = {
		...context,
		cache: new AutoReviewCache(),
		signal: abort.signal,
	};
	contexts.set(id, bound);
	return {
		attached: true,
		invalidate: (cancelPermits = true) => {
			bound.cache.clear();
			// 入力の更新では、既に起動した非同期子ジョブまで中断しない。
			if (!cancelPermits) {
				return;
			}
			abort.abort();
			abort = new AbortController();
			bound.signal = abort.signal;
		},
		dispose: () => {
			abort.abort();
			bound.cache.clear();
			if (contexts.get(id) === bound) {
				contexts.delete(id);
			}
		},
	};
}

/** 外部入力の ID を使わず、Host 内の実効ポリシーからだけ接続を得る。 */
export function autoReviewContext(call: ToolCall) {
	return contexts.get(call.policy.trustContextId ?? "");
}
