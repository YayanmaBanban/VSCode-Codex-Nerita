// 会話全体の元データを検索し、本文や DOM を複製せず一致位置だけを保存する。
import type { ToolSummary } from "@nerita/shared/chatState";
import type { ToolContent } from "@nerita/shared/toolContent";
import type { TimelineEntry } from "../messages/messageTimeline";
import { agentName } from "../agents/AgentCard";
import { findMatches, matchLimit } from "./findMatches";

/** 行内での一致位置と、折り畳み本文を開く必要があるか。 */
export type SearchHit = {
	entryKey: string;
	start: number;
	end: number;
	ordinal: number;
	body: boolean;
};

/** 表示範囲に関係なく、保持しているチャットデータ全件を検索する。 */
export function searchTimeline(entries: TimelineEntry[], pattern: RegExp) {
	const hits: SearchHit[] = [];
	for (const entry of entries) {
		let ordinal = 0;
		let field = 0;
		for (const text of entryTexts(entry)) {
			for (const match of findMatches(
				text,
				pattern,
				matchLimit - hits.length,
			)) {
				hits.push({
					entryKey: entry.key,
					...match,
					ordinal: ordinal++,
					body: entry.kind === "tool" && field > 0,
				});
			}
			if (hits.length >= matchLimit) {
				return { hits, limited: true };
			}
			field++;
		}
	}
	return { hits, limited: false };
}

/** Markdown 原文とカードの表示元を参照し、JSON の生データ全体は文字列化しない。 */
function* entryTexts(entry: TimelineEntry): Generator<string> {
	if (entry.kind === "message") {
		yield entry.message.text;
	} else if (entry.kind === "tool") {
		yield* toolTexts(entry.tool);
	} else {
		yield agentName(entry.agent);
		for (const text of [
			entry.agent.role,
			entry.agent.model,
			entry.agent.reasoningEffort,
		]) {
			if (text !== undefined && text !== "") {
				yield text;
			}
		}
	}
}

/** 未取得の出力は検索せず、受信済みの本文とプレビューだけを対象にする。 */
function* toolTexts(tool: ToolSummary): Generator<string> {
	yield tool.title;
	if (tool.output) {
		yield tool.output.preview;
	} else if (tool.commandOutput !== undefined && tool.commandOutput !== "") {
		yield tool.commandOutput;
	} else {
		for (const content of tool.content ?? []) {
			yield* contentTexts(content);
		}
	}
}

/** 正規化した本文を参照したまま、差分の変更前後をそれぞれ検索する。 */
function* contentTexts(content: ToolContent): Generator<string> {
	if (content.type === "content") {
		yield content.content.text;
	} else if (content.type === "unifiedDiff") {
		yield content.diff;
	} else if (content.type === "diff") {
		if (content.oldText !== null) {
			yield content.oldText;
		}
		yield content.newText;
	}
}
