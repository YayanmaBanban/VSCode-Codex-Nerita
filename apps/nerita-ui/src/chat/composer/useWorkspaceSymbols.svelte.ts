// 検索語の変更をまとめ、閉じたメニューや古い要求への応答を捨てる。
import { nonEmptyString } from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";

import {
	isSymbolQuery,
	type WorkspaceSymbolsResult,
} from "@nerita/shared/workspaceSymbols";

import { symbolCompletionItems } from "./completionItems";
/** ワークスペースのシンボル候補を検索する。Svelte の寿命管理内で呼び出し、接続と検索条件は最新値を参照できるようにする。 */
export function useWorkspaceSymbols(input: {
	bridge: Bridge | undefined;
	active: boolean;
	query: string;
}) {
	const bridge = $derived(input.bridge);
	const active = $derived(input.active);
	const query = $derived(input.query);

	const term = $derived(query.trim());
	let result = $state.raw<{
		query: string;
		data: WorkspaceSymbolsResult;
	} | null>(null);
	/** 検索語に結び付いたシンボルの取得結果を、直接値または更新処理で保持する。 */
	const setResult = (
		value: typeof result | ((previous: typeof result) => typeof result),
	) => {
		result = typeof value === "function" ? value(result) : value;
	};
	/** 有効な検索語だけを遅延送信し、要求の切替と破棄ではタイマーと購読を解除する。 */
	$effect(() => searchWorkspaceSymbols(bridge, active, term, setResult));
	const data = $derived(result?.query === term ? result.data : null);
	const items = $derived(symbolCompletionItems(data?.entries ?? []));
	return {
		get items() {
			return items;
		},
		get empty() {
			return emptySymbolMessage(bridge, term, data);
		},
		get notice() {
			return data?.truncated === true
				? "先頭100件を表示しています。検索語を絞り込んでください。"
				: undefined;
		},
	};
}

/** 接続・検索語・取得状態の順にシンボル候補がない理由を返す。 */
function emptySymbolMessage(
	bridge: Bridge | undefined,
	term: string,
	data: WorkspaceSymbolsResult | null,
) {
	if (!bridge) {
		return "シンボル検索を利用できません。";
	}
	if (term === "") {
		return "シンボル名を入力してください。";
	}
	if (!isSymbolQuery(term)) {
		return "検索語は256文字以内で入力してください。";
	}
	if (!data) {
		return "検索中…";
	}
	return (
		nonEmptyString(data.error) ??
		"候補がありません。検索語や言語拡張の対応を確認してください。"
	);
}

/** 検索語を要求に固定し、終了時にタイマーと購読を解放する。 */
function searchWorkspaceSymbols(
	bridge: Bridge | undefined,
	active: boolean,
	term: string,
	setResult: (
		value: { query: string; data: WorkspaceSymbolsResult } | null,
	) => void,
) {
	setResult(null);
	if (!active || !bridge || term === "") {
		return;
	}
	if (!isSymbolQuery(term)) {
		return;
	}
	const requestedTerm = term;
	const requestId = crypto.randomUUID();
	let finished = false;
	/** シンボルの応答を要求時の検索語に結び付け、一度だけ取得結果として確定する。 */
	const complete = (data: WorkspaceSymbolsResult) => {
		if (finished) {
			return;
		}
		finished = true;
		setResult({ query: requestedTerm, data });
	};
	const unsubscribe = bridge.subscribe((message) => {
		const matchesType =
			message.type === "workspace/symbols" &&
			message.requestId === requestId;
		if (matchesType) {
			complete(message);
		}
	});
	const timer = setTimeout(
		() =>
			bridge.postMessage({
				type: "workspace/searchSymbols",
				requestId,
				query: requestedTerm,
			}),
		250,
	);
	const timeout = setTimeout(
		() =>
			complete({
				type: "workspace/symbols",
				requestId,
				entries: [],
				truncated: false,
				error: "検索がタイムアウトしました。検索語を変更して再試行してください。",
			}),
		10_000,
	);
	return () => {
		finished = true;
		clearTimeout(timer);
		clearTimeout(timeout);
		unsubscribe();
	};
}
