// 保存形式ごとの履歴を取得し、表示中の会話を変更せずに復元データを組み立てる。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import {
	initialState,
	type ChatState,
	type ChatMessage,
} from "@nerita/shared/chatState";
import type { Attachment } from "@nerita/shared/composer";
import { win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord } from "@nerita/shared/validation";
import { nextTimelineOrder } from "../../../session/timelineOrder";
import type { CodexConnection } from "../runtime/connection";
import type { HistoryThread, HistoryTurn } from "../protocol/history";
import { itemPatch } from "../items/chatItems";
import { ToolOutputStore } from "../../../session/ToolOutputStore";
import { setImmediate } from "node:timers/promises";

/** 接続世代とカーソルの循環を確認しながら全ページを取得する。 */
async function* historyPages<T>(
	fetch: (
		cursor?: string,
	) => Promise<{ data: T[]; nextCursor: string | null }>,
	current: () => boolean,
): AsyncGenerator<T[]> {
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
		yield page.data;
		if (!current()) {
			throw new Error("Stale history");
		}
		cursor = page.nextCursor ?? undefined;
		if (cursor !== undefined && seen.has(cursor)) {
			throw new Error("Repeated history cursor");
		}
		if (cursor !== undefined) {
			seen.add(cursor);
		}
	} while (cursor !== undefined);
}

/** 上限付きの会話参照では、既存の全件取得契約を維持する。 */
async function pages<T>(
	fetch: (
		cursor?: string,
	) => Promise<{ data: T[]; nextCursor: string | null }>,
	current: () => boolean,
): Promise<T[]> {
	const data: T[] = [];
	for await (const page of historyPages(fetch, current)) {
		data.push(...page);
	}
	return data;
}

/** 全文をページごとに退避し、復元成功までは現在の会話と出力参照を変更しない。 */
export async function restoreDisplayHistory(
	client: Pick<CodexConnection, "listTurns" | "listItems">,
	thread: HistoryThread,
	current: () => boolean,
	readonly = false,
) {
	const state = initialState();
	state.sessionId = thread.id;
	const outputs = new ToolOutputStore();
	const seen = new Set<string>();
	try {
		const turnPages =
			thread.historyMode === "paginated"
				? historyPages(
						(cursor) =>
							client.listTurns(thread.id, cursor, "summary"),
						current,
					)
				: [thread.turns];
		for await (const turns of turnPages) {
			for (const turn of turns) {
				validateDisplayTurn(turn, seen, readonly);
				await restoreDisplayTurn(client, state, turn, outputs, current);
			}
		}
		if (!current()) {
			throw new Error("Stale history");
		}
		return {
			state: {
				messages: state.messages,
				tools: state.tools,
				agents: state.agents,
			},
			outputs,
		};
	} catch (error) {
		outputs.dispose();
		throw error;
	}
}

/** ページ間でのターン ID の重複を拒否し、閲覧専用でない場合は実行中ターンも拒否する。 */
function validateDisplayTurn(
	turn: HistoryTurn,
	seen: Set<string>,
	readonly: boolean,
) {
	if (seen.has(turn.id) || (turn.status === "inProgress" && !readonly)) {
		throw new Error("Invalid history turn");
	}
	seen.add(turn.id);
}

/** 次ページへ進む前に出力を書き終え、通知と取消しを処理できるよう制御を戻す。 */
async function restoreDisplayTurn(
	client: Pick<CodexConnection, "listItems">,
	state: ChatState,
	turn: HistoryTurn,
	outputs: ToolOutputStore,
	current: () => boolean,
) {
	for await (const items of displayItemPages(
		client,
		state.sessionId!,
		turn,
		current,
	)) {
		applyHistoryItems(state, turn, items, outputs);
		await outputs.flush();
		await setImmediate();
		if (!current()) {
			throw new Error("Stale history");
		}
	}
}

/** 項目ページも一ページずつ検証し、別ターンの混入を拒否する。 */
async function* displayItemPages(
	client: Pick<CodexConnection, "listItems">,
	threadId: string,
	turn: HistoryTurn,
	current: () => boolean,
) {
	if (!current()) {
		throw new Error("Stale history");
	}
	if (turn.itemsView === "full") {
		yield turn.items;
		return;
	}
	for await (const entries of historyPages(
		(cursor) => client.listItems(threadId, turn.id, cursor),
		current,
	)) {
		if (entries.some((entry) => entry.turnId !== turn.id)) {
			throw new Error("Unexpected turn");
		}
		yield entries.map((entry) => entry.item);
	}
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
/** ユーザー本文を復元し、添付は内容を本文へ含めず、表示用の名前と URI に変換する。 */
function userContent(
	content: unknown,
): Pick<ChatMessage, "text" | "attachments"> {
	if (!Array.isArray(content)) {
		throw new Error("Invalid user history");
	}
	const attachments: Attachment[] = [];
	const text = content
		.map((part: unknown, index) => {
			if (!isRecord(part)) {
				throw new Error("Invalid user input");
			}
			const path = historyAttachmentPath(part, index);
			if (isNonEmptyString(path)) {
				attachments.push({
					id: `attachment:${index}`,
					name: win32.basename(path),
					uri: pathToFileURL(path).href,
				});
				return "";
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
		.filter(Boolean)
		.join("\n\n");
	return { text, attachments };
}

/** 通常のユーザー本文を添付と誤認しないよう、テキスト添付は2番目以降から取り出す。 */
function historyAttachmentPath(
	part: Record<string, unknown>,
	index: number,
): string | undefined {
	if (part.type === "localImage" && typeof part.path === "string") {
		return part.path;
	}
	if (index > 0 && part.type === "text" && typeof part.text === "string") {
		return /^添付ファイル: ([^\r\n]+)\r?\n/.exec(part.text)?.[1];
	}
	return undefined;
}
/** 全項目の変換成功後にだけ公開できる表示スナップショットを作る。 */
export function replayHistory(turns: HistoryTurn[], threadId = "history") {
	const state = initialState();
	state.sessionId = threadId;
	for (const turn of turns) {
		applyHistoryItems(state, turn, turn.items);
	}
	return {
		messages: state.messages,
		tools: state.tools,
		agents: state.agents,
	};
}

/** ページ間でも同じ項目の順序を保ち、出力ストアが指定された場合はツールの全文を状態から退避する。 */
function applyHistoryItems(
	state: ChatState,
	turn: HistoryTurn,
	items: Record<string, unknown>[],
	outputs?: ToolOutputStore,
) {
	state.runId = `history:${turn.id}`;
	for (const item of new Map(
		items.map((entry) => [entry.id, entry]),
	).values()) {
		if (item.type === "userMessage") {
			const id = `${state.runId}:${String(item.id)}`;
			const previous = state.messages.find(
				(message) => message.id === id,
			);
			if (previous) {
				Object.assign(previous, userContent(item.content));
			} else {
				state.messages.push({
					id,
					role: "user",
					...userContent(item.content),
					order: nextTimelineOrder(state),
				});
			}
		} else {
			const completed =
				turn.status !== "inProgress" ||
				!["inProgress", "running", "pending"].includes(
					String(item.status),
				);
			const patch = itemPatch(state, item, completed);
			if (outputs && patch.tools) {
				patch.tools = patch.tools.map((tool) => outputs.project(tool));
			}
			Object.assign(state, patch);
		}
	}
}
