// 確定済みメッセージの先頭ツールが `write` / `edit` の場合だけ審査を先読みする。
import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { prefetchToolReview } from "../../security/ApprovalGuard";
import { preparePiFileCall } from "./PiFileTools";

/** 未確定の引数や後続の予定操作は送らず、Stop・ユーザー入力で先読みを破棄する。 */
export function bindPiReviewPrefetch(
	session: AgentSession,
	paths: WorkspacePathPolicy,
	lifetime: AbortSignal,
	invalidate: (cancelPermits?: boolean) => void,
) {
	let turn = new AbortController();
	/** 同じ依頼文を再送した場合も、以前の承認根拠を使い回さない。 */
	const reset = (cancelPermits = false) => {
		turn.abort();
		invalidate(cancelPermits);
		turn = new AbortController();
	};
	/** 確定した SDK メッセージからだけ先読みし、会話更新はその前に失効させる。 */
	const onEvent = (event: AgentSessionEvent) => {
		if (event.type === "agent_end") {
			// 非同期の子ジョブは親の応答後も動くため、先読みだけを回収する。
			turn.abort();
			turn = new AbortController();
			return;
		}
		if (event.type === "agent_start") {
			reset();
			return;
		}
		if (event.type === "message_start" && event.message.role === "user") {
			reset();
			return;
		}
		const call = firstFileCall(event);
		if (!call) {
			return;
		}
		const signal = AbortSignal.any([lifetime, turn.signal]);
		// 履歴ファイルへの保存完了は待たない。実行時と入力変換の結果が異なれば、判定を再利用しない。
		void preparePiFileCall(call.name, call.arguments, paths)
			.then((input) => prefetchToolReview(input, signal))
			.catch(() => {
				/* 先読みが失敗しても、実際の呼び出し時に通常の検査を通す。 */
			});
	};
	const unsubscribe = session.subscribe(onEvent);
	const abort = session.abort.bind(session);
	session.abort = async () => {
		reset(true);
		await abort();
	};
	return () => {
		unsubscribe();
		reset(true);
	};
}

/** 後続ツールは先行ツールの副作用に依存し得るため、先頭ツールが書き込み・編集の場合だけ選ぶ。 */
function firstFileCall(
	event: AgentSessionEvent,
): { name: "write" | "edit"; arguments: unknown } | undefined {
	if (event.type !== "message_end") {
		return undefined;
	}
	if (event.message.role !== "assistant") {
		return undefined;
	}
	if (event.message.stopReason !== "toolUse") {
		return undefined;
	}
	const call = event.message.content.find((part) => part.type === "toolCall");
	if (call?.type !== "toolCall") {
		return undefined;
	}
	if (call.name !== "write" && call.name !== "edit") {
		return undefined;
	}
	return { name: call.name, arguments: call.arguments };
}
