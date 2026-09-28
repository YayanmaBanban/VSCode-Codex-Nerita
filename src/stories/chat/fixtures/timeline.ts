// 受信順の履歴の表示を確認する固定データ。
import type { ChatState } from "../../../shared/chatState";
/** ストーリーと UI 検証で同じ表示データを使う。 */
export function timelineMessages(): ChatState["messages"] {
	return [
		{
			id: "user",
			role: "user",
			text: "テストしてください",
			order: 1,
		},
		{
			id: "before",
			role: "assistant",
			text: "テストを実行します。",
			order: 2,
		},
		{
			id: "after",
			role: "assistant",
			text: "テストが成功しました。",
			order: 4,
		},
	];
}
