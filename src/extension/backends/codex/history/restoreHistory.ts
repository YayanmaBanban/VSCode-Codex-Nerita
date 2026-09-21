// 保存形式ごとの履歴を取得し、表示中の会話を変更せずに復元データを組み立てる。
import { initialState } from "../../../../shared/chatState";
import { isRecord } from "../../../../shared/validation";
import { nextTimelineOrder } from "../../../session/timelineOrder";
import type { CodexConnection } from "../runtime/connection";
import type { HistoryThread, HistoryTurn } from "../protocol/history";
import { itemPatch } from "../items/chatItems";

/** 接続世代とカーソルの循環を確認しながら全ページを取得する。 */
async function pages<T>(
	fetch: (
		cursor?: string,
	) => Promise<{ data: T[]; nextCursor: string | null }>,
	current: () => boolean,
): Promise<T[]> {
	const data: T[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined;
	do {
		if (!current()) {
			throw new Error("Stale history");
		}
		const page = await fetch(cursor);
		if (!current()) {
			throw new Error("Stale history");
		}
		data.push(...page.data);
		cursor = page.nextCursor ?? undefined;
		if (cursor !== undefined && seen.has(cursor)) {
			throw new Error("Repeated history cursor");
		}
		if (cursor !== undefined) {
			seen.add(cursor);
		}
	} while (cursor !== undefined);
	return data;
}
/** 新旧形式を共通の時系列に揃え、要約項目は本文まで読み込む。 */
export async function hydrateHistory(
	client: Pick<CodexConnection, "listTurns" | "listItems">,
	thread: HistoryThread,
	current: () => boolean,
	readonly = false,
): Promise<HistoryTurn[]> {
	const turns =
		thread.historyMode === "paginated"
			? await pages(
					(cursor) => client.listTurns(thread.id, cursor),
					current,
				)
			: thread.turns;
	const result = new Map<string, HistoryTurn>();
	for (const turn of turns) {
		if (turn.status === "inProgress" && !readonly) {
			throw new Error("Active history");
		}
		let items = turn.items;
		if (turn.itemsView !== "full") {
			const entries = await pages(
				(cursor) => client.listItems(thread.id, turn.id, cursor),
				current,
			);
			if (entries.some((entry) => entry.turnId !== turn.id)) {
				throw new Error("Unexpected turn");
			}
			items = entries.map((entry) => entry.item);
		}
		result.set(turn.id, { ...turn, items, itemsView: "full" });
	}
	return [...result.values()];
}
/** 添付バイナリを露出せずにユーザー入力を復元する。 */
function userText(content: unknown): string {
	if (!Array.isArray(content)) {
		throw new Error("Invalid user history");
	}
	return content
		.map((part: unknown) => {
			if (!isRecord(part)) {
				throw new Error("Invalid user input");
			}
			if (part.type === "text" && typeof part.text === "string") {
				return part.text;
			}
			if (part.type === "image" || part.type === "localImage") {
				return "[画像添付]";
			}
			if (part.type === "audio") {
				return "[音声添付]";
			}
			return typeof part.name === "string" ? `@${part.name}` : "[添付]";
		})
		.join("\n\n");
}
/** 全項目の変換成功後にだけ公開できる表示スナップショットを作る。 */
export function replayHistory(turns: HistoryTurn[], threadId = "history") {
	const state = initialState();
	state.sessionId = threadId;
	for (const turn of turns) {
		state.runId = `history:${turn.id}`;
		const items = new Map(turn.items.map((item) => [item.id, item]));
		for (const item of items.values()) {
			if (item.type === "userMessage") {
				state.messages.push({
					id: `${state.runId}:${String(item.id)}`,
					role: "user",
					text: userText(item.content),
					order: nextTimelineOrder(state),
				});
			} else {
				const completed =
					turn.status !== "inProgress" ||
					!["inProgress", "running", "pending"].includes(
						String(item.status),
					);
				Object.assign(state, itemPatch(state, item, completed));
			}
		}
	}
	return {
		messages: state.messages,
		tools: state.tools,
		agents: state.agents,
	};
}
