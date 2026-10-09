// 描画・検索・スクロール移動で共用する、会話の時系列と安定した行 ID を作る。
import type { ChatMessage, ToolSummary } from "@nerita/shared/chatState";
import type { SubAgentSummary } from "@nerita/shared/subAgents";

/** 元データへの参照と、描画時に必要な関連行。 */
export type TimelineEntry = { key: string; order: number } & (
	| { kind: "message"; message: ChatMessage; previousUser?: ChatMessage }
	| { kind: "tool"; tool: ToolSummary; parent?: ToolSummary }
	| { kind: "agent"; agent: SubAgentSummary }
);

/** 画面外の行も ID で特定できる会話一覧。 */
export type MessageTimeline = {
	entries: TimelineEntry[];
	indexByKey: Map<string, number>;
};

/** 実行をまたいで同じ ID のツールを区別する。 */
export function toolEntryKey(tool: Pick<ToolSummary, "runId" | "id">) {
	return `tool:${JSON.stringify([tool.runId ?? "", tool.id])}`;
}

/** 送信文と親ツールを一度だけ対応付け、全項目を表示順へ並べる。 */
export function messageTimeline(
	messages: ChatMessage[],
	tools: ToolSummary[] = [],
	agents: SubAgentSummary[] = [],
): MessageTimeline {
	let previousUser: ChatMessage | undefined;
	const entries: TimelineEntry[] = messages.map((message, index) => {
		const entry: TimelineEntry = {
			kind: "message",
			key: `message:${message.id}`,
			order: message.order ?? index,
			message,
			...(previousUser ? { previousUser } : {}),
		};
		if (message.role === "user") {
			previousUser = message;
		}
		return entry;
	});
	const toolsByKey = new Map(tools.map((tool) => [toolEntryKey(tool), tool]));
	tools.forEach((tool, index) => {
		const parent =
			tool.parentToolCallId !== undefined && tool.parentToolCallId !== ""
				? toolsByKey.get(
						toolEntryKey({ ...tool, id: tool.parentToolCallId }),
					)
				: undefined;
		entries.push({
			kind: "tool",
			key: toolEntryKey(tool),
			order: tool.order ?? messages.length + index,
			tool,
			...(parent ? { parent } : {}),
		});
	});
	agents.forEach((agent) =>
		entries.push({
			kind: "agent",
			key: `agent:${agent.threadId}`,
			order: agent.order,
			agent,
		}),
	);
	entries.sort((a, b) => a.order - b.order);
	return {
		entries,
		indexByKey: new Map(entries.map((entry, index) => [entry.key, index])),
	};
}
