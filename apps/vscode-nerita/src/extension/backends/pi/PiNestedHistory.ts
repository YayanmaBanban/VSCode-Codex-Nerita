// SDK が親ツールの結果へ保存した子の要約を、再実行せず表示用カードへ復元する。
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { ChatState, ToolSummary } from "@nerita/shared/chatState";
import { mapPiTool } from "./PiToolMapper";

const nestedStatuses = {
	ok: "completed",
	error: "failed",
	unfinished: "unfinished",
} satisfies Record<string, ToolSummary["status"]>;

/** 結果本文のない子の履歴と、省略された記録を区別して復元する。 */
export function restorePiNestedTools(
	message: Extract<SessionMessageEntry["message"], { role: "toolResult" }>,
	state: ChatState,
) {
	const nested = message.nestedCalls;
	if (!nested) {
		return;
	}
	if (!nested.complete) {
		state.tools = state.tools.map((tool) =>
			tool.id === message.toolCallId && tool.runId === state.runId
				? { ...tool, nestedCallsIncomplete: true }
				: tool,
		);
	}
	for (const call of nested.calls) {
		// SDK は多段の呼び出しを <親 ID>/<連番> として保存する。
		const parentToolCallId = call.id.startsWith(`${message.toolCallId}/`)
			? call.id.slice(0, call.id.lastIndexOf("/"))
			: message.toolCallId;
		Object.assign(
			state,
			mapPiTool(
				{
					type: "tool_execution_start",
					toolCallId: call.id,
					toolName: call.name,
					args: call.arguments,
					parentToolCallId,
				},
				state,
			),
		);
		state.tools = state.tools.map((tool): ToolSummary =>
			tool.id === call.id && tool.runId === state.runId
				? {
						...tool,
						status: nestedStatuses[call.status],
						summaryOnly: true,
						...(call.argumentsBytes === undefined
							? {}
							: { omittedArgumentBytes: call.argumentsBytes }),
						content: call.error
							? [
									{
										type: "content",
										content: {
											type: "text",
											text: call.error,
										},
									},
								]
							: [],
					}
				: tool,
		);
	}
}
