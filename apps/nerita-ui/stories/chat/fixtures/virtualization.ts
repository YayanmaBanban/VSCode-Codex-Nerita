// 可変高さの長い会話と、画面外にある折り畳み本文を用意する。
import type { ChatState } from "@nerita/shared/chatState";

/** 行の高さと検索位置を変え、仮想一覧の描画範囲で起きる不具合を再現する。 */
export function virtualizationData(): Pick<ChatState, "messages" | "tools"> {
	return {
		messages: Array.from({ length: 200 }, (_, index) => ({
			id: `virtual-message-${index}`,
			order: index * 2,
			role: index % 10 === 0 ? "user" : "assistant",
			text: messageText(index),
		})),
		tools: Array.from({ length: 200 }, (_, index) => ({
			id: `virtual-tool-${index}`,
			runId: "virtual-run",
			order: index * 2 + 1,
			title: index === 0 ? "冒頭ツール" : `ツール ${index}`,
			kind: "execute",
			status: "completed",
			paths: [],
			output: {
				preview:
					index === 0
						? `折り畳み検索対象\n${"長い実行結果\n".repeat(30)}`
						: "実行結果",
				truncated: false,
			},
		})),
	};
}

/** 先頭と末尾に固有の検索語を置き、中間は高さを変える。 */
function messageText(index: number) {
	if (index === 0) {
		return "先頭の検索対象 **装飾語**";
	}
	if (index === 199) {
		return "末尾の検索対象";
	}
	return `履歴 ${index}: 周辺表示の確認。\n\n${"高さが変わる会話です。\n\n".repeat((index % 7) + 1)}`;
}
