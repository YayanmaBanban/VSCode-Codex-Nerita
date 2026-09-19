// MCP取得の待機から完了までを、Storybook内の遅延応答で再現する。
import type { ChatState } from "../../../shared/chatState";
import type { HostMessage } from "../../../shared/messages";
import { mcpSummaryText } from "../../../shared/mcp";
import { mcpServersFixture } from "../../../../tests/fixtures/mcpStatusFixture";

/** 取得中メッセージを先に表示し、同じメッセージを一覧へ置き換える。 */
export function mockMcpCommand(
	state: ChatState,
	requestId: string,
	order: number,
	patch: (changes: Partial<ChatState>) => void,
	emit: (message: HostMessage) => void,
) {
	const id = crypto.randomUUID();
	const messages: ChatState["messages"] = [
		...state.messages,
		{ id: crypto.randomUUID(), role: "user", text: "/mcp", order },
		{
			id,
			role: "assistant",
			text: "取得中…",
			streaming: false,
			order: order + 1,
			mcp: { status: "loading" },
		},
	];
	patch({ messages });
	return setTimeout(() => {
		patch({
			messages: messages.map((message) =>
				message.id === id
					? {
							...message,
							text: mcpSummaryText(mcpServersFixture),
							mcp: {
								status: "ready",
								servers: mcpServersFixture,
							},
						}
					: message,
			),
		});
		emit({ type: "prompt/accepted", requestId, mode: "start" });
	}, 1600);
}
