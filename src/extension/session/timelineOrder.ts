// 履歴再生で受け取った多数の項目より後ろへ、新しい表示項目を採番する。
import type { ChatState } from "../../shared/messages";
/** 通知番号と既存項目の表示順の両方より大きい値を返す。 */
export function nextTimelineOrder(state: ChatState): number {
	let order = state.revision;
	for (const item of [...state.messages, ...state.tools, ...state.agents]) {
		order = Math.max(order, item.order ?? 0);
	}
	return order + 1;
}
