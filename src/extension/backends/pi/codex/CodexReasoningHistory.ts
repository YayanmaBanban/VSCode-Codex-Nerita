// 推論更新を会話本文と分離して永続化し、現在の分岐に残った記録だけ復元する。
import { createHash } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../../../shared/validation";

export const reasoningHistoryType = "nerita.codex.reasoning.v1";
const efforts = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
/** Pi で変換済みの既知の通信形式の値だけを履歴へ保存する。 */
export type CodexEffort = (typeof efforts)[number];
/** `index` は `configuration_update` を除いた `input` での挿入位置。 */
export type EffortTransition = {
	index: number;
	anchor: string;
	effort: CodexEffort;
};
/** `baseline` も履歴の `prefix` に結び付け、本文編集後の古い固定値を適用しない。 */
export type ReasoningHistory = {
	modelKey: string;
	baseline: CodexEffort;
	index: number;
	anchor: string;
	transitions: EffortTransition[];
};
/** 書込みと現在分岐の読取りだけに依存する。 */
export type ReasoningHistoryStore = Pick<
	SessionManager,
	"getBranch" | "appendCustomEntry"
>;

/** 未知値や Ultra を通常の `configuration_update` へ混入させない。 */
export function isCodexEffort(value: unknown): value is CodexEffort {
	return efforts.some((effort) => effort === value);
}

/** 再送時に変化する出力専用属性を除き、本文自体は保存せず照合する。 */
export function historyAnchor(input: unknown[], index: number): string {
	const stable = input.slice(0, index).map((item) => {
		if (!isRecord(item)) {
			return item;
		}
		return Object.fromEntries(
			Object.entries(item).filter(
				([key]) => key !== "id" && key !== "status",
			),
		);
	});
	return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** 保存形式を検証し、壊れた記録や任意文字列を要求へ持ち込まない。 */
function isHistory(value: unknown): value is ReasoningHistory {
	return (
		isRecord(value) &&
		typeof value.modelKey === "string" &&
		isCodexEffort(value.baseline) &&
		validAnchor(value) &&
		Array.isArray(value.transitions) &&
		(value.transitions as unknown[]).every(
			(entry, index, all) =>
				isRecord(entry) &&
				validAnchor(entry) &&
				isCodexEffort(entry.effort) &&
				(index === 0 || follows(entry.index, all[index - 1])),
		)
	);
}

/** 順序の壊れた保存値は復元しない。 */
function follows(index: number, previous: unknown): boolean {
	return (
		isRecord(previous) &&
		typeof previous.index === "number" &&
		index > previous.index
	);
}

/** 配列位置とハッシュの外形を確認する。 */
function validAnchor(
	value: Record<string, unknown>,
): value is Record<string, unknown> & { index: number; anchor: string } {
	return (
		typeof value.index === "number" &&
		Number.isSafeInteger(value.index) &&
		value.index >= 0 &&
		typeof value.anchor === "string" &&
		/^[a-f0-9]{64}$/.test(value.anchor)
	);
}

/** 成功した圧縮・モデル切替・分岐要約以降の信頼済みの記録だけを採用する。 */
export function readReasoningHistory(
	store: ReasoningHistoryStore,
): ReasoningHistory | undefined {
	let state: ReasoningHistory | undefined;
	for (const entry of store.getBranch()) {
		if (
			[
				"compaction",
				"branch_summary",
				"model_change",
				"context_edit",
			].includes(entry.type)
		) {
			state = undefined;
		} else if (
			entry.type === "custom" &&
			entry.customType === reasoningHistoryType
		) {
			state = isHistory(entry.data)
				? structuredClone(entry.data)
				: undefined;
		}
	}
	return state;
}
