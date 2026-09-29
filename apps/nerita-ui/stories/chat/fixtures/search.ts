// 会話検索の表示を確認する固定データ。
import type { ChatState } from "@nerita/shared/chatState";
/** ストーリーと UI 検証で同じ表示データを使う。 */
export function searchMessages(): ChatState["messages"] {
	return [
		{
			id: "search-user",
			role: "user",
			text: "Power power powerful power_1",
		},
		{
			id: "search-assistant",
			role: "assistant",
			text: [
				"power **station** POWER",
				"猫 猫舌 子猫",
				...Array.from(
					{ length: 15 },
					(_, index) =>
						`補足 ${index + 1}: 検索位置へスクロールできる長い会話です。`,
				),
				"```text\npower[1] power(2)\n```",
			].join("\n\n"),
		},
	];
}
