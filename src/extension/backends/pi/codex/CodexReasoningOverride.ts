// 対応モデルの要求の基準値を固定し、信頼済みの推論変更を元の履歴位置へ再挿入する。
import { isRecord } from "../../../../shared/validation";
import {
	historyAnchor,
	isCodexEffort,
	readReasoningHistory,
	reasoningHistoryType,
	type ReasoningHistory,
	type ReasoningHistoryStore,
	type CodexEffort,
} from "./CodexReasoningHistory";

/** 状態の正本を Pi の分岐履歴に置き、再起動・`fork` でも同じ要求を再構成する。 */
export class CodexReasoningOverride {
	/** 非対応・Ultra への移行時は古い固定値の復活を防ぐ。 */
	clear(store: ReasoningHistoryStore): void {
		if (readReasoningHistory(store)) {
			store.appendCustomEntry(reasoningHistoryType, null);
		}
	}

	/** 通信形式へ変換済みの `effort` を使い、Pi の `thinkingLevelMap` と範囲内への補正を尊重する。 */
	rewrite(
		payload: unknown,
		modelKey: string,
		store: ReasoningHistoryStore,
	): unknown {
		if (!isReasoningPayload(payload)) {
			return undefined;
		}
		const selected = payload.reasoning.effort;
		const previous = readReasoningHistory(store);
		const input = removeTrustedUpdates(payload.input, previous);
		// 他拡張の更新を推測で取り込まず、その拡張の要求をそのまま維持する。
		if (!input) {
			return undefined;
		}
		let state: ReasoningHistory;
		if (previous?.modelKey === modelKey && survives(previous, input)) {
			state = structuredClone(previous);
		} else {
			state = {
				modelKey,
				baseline: selected,
				index: input.length,
				anchor: historyAnchor(input, input.length),
				transitions: [],
			};
		}
		updateTail(state, input, selected);
		const rewritten = [...input];
		for (const [offset, entry] of state.transitions.entries()) {
			rewritten.splice(entry.index + offset, 0, {
				type: "configuration_update",
				reasoning: { effort: entry.effort },
			});
		}
		if (JSON.stringify(previous) !== JSON.stringify(state)) {
			store.appendCustomEntry(reasoningHistoryType, state);
		}
		return {
			...payload,
			reasoning: { ...payload.reasoning, effort: state.baseline },
			input: rewritten,
		};
	}
}

/** 不正な要求の書き換えや履歴追加は行わない。 */
function isReasoningPayload(value: unknown): value is Record<
	string,
	unknown
> & {
	reasoning: Record<string, unknown> & { effort: CodexEffort };
	input: Record<string, unknown>[];
} {
	return (
		isRecord(value) &&
		isRecord(value.reasoning) &&
		isCodexEffort(value.reasoning.effort) &&
		Array.isArray(value.input) &&
		value.input.every(isRecord)
	);
}

/** 同一末尾の再試行では置換し、連続更新を生成しない。 */
function updateTail(
	state: ReasoningHistory,
	input: unknown[],
	selected: CodexEffort,
): void {
	const effective = state.transitions.at(-1)?.effort ?? state.baseline;
	if (selected === effective) {
		return;
	}
	const index = input.length;
	state.transitions = state.transitions.filter(
		(entry) => entry.index !== index,
	);
	const preceding = state.transitions.at(-1)?.effort ?? state.baseline;
	if (preceding !== selected) {
		state.transitions.push({
			index,
			anchor: historyAnchor(input, index),
			effort: selected,
		});
	}
}

/** 短縮・本文置換があれば古いコンテキストウィンドウの固定値を破棄する。 */
function survives(state: ReasoningHistory, input: unknown[]): boolean {
	return [state, ...state.transitions].every(
		(entry) =>
			entry.index <= input.length &&
			entry.anchor === historyAnchor(input, entry.index),
	);
}

/** 再入力された信頼済みの更新だけを除き、再構成時の重複を防ぐ。 */
function removeTrustedUpdates(
	input: Record<string, unknown>[],
	state: ReasoningHistory | undefined,
) {
	const clean: Record<string, unknown>[] = [];
	const seen = new Set<number>();
	for (const item of input) {
		if (item.type !== "configuration_update") {
			clean.push(item);
			continue;
		}
		const entry = state?.transitions.find(
			(entry) => entry.index === clean.length,
		);
		if (
			!entry ||
			seen.has(entry.index) ||
			!isRecord(item.reasoning) ||
			item.reasoning.effort !== entry.effort ||
			entry.anchor !== historyAnchor(clean, clean.length)
		) {
			return undefined;
		}
		seen.add(entry.index);
	}
	return clean;
}
