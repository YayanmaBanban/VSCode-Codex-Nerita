// 作業エージェントから変更できない、Host 登録のレビュー実行先と親会話を参照する。
import type { AutoReviewConfig } from "@nerita/shared/agentManager/autoReview";
import type { ToolCall } from "./ApprovedToolCall";
import type { AutoReviewRecord } from "@nerita/shared/guardrails/review";

/** 会話の出所を維持し、子のタスクやツール出力をユーザー承認へ昇格させない。 */
export type ReviewEvidence = {
	role: "user" | "assistant" | "tool";
	text: string;
};
/** モデルの接続と認証は Pi の Runtime が所有し、共通ガードには公開しない。 */
export type AutoReviewContext = {
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
export function bindAutoReviewContext(id: string, context: AutoReviewContext) {
	if (contexts.has(id)) {
		return () => {};
	}
	contexts.set(id, context);
	return () => {
		if (contexts.get(id) === context) {
			contexts.delete(id);
		}
	};
}

/** 外部入力の ID を使わず、Host 内の実効ポリシーからだけ接続を得る。 */
export function autoReviewContext(call: ToolCall) {
	return contexts.get(call.policy.trustContextId ?? "");
}
