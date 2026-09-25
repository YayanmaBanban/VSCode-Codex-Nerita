// 検索語の変更をまとめ、閉じたメニューや古い要求への応答を捨てる。
import { useEffect, useState } from "react";
import type { Bridge } from "../../vscodeBridge";
import {
	isSymbolQuery,
	type WorkspaceSymbolsResult,
} from "../../../shared/workspaceSymbols";
import { symbolCompletionItems } from "./completionItems";

/** 入力から250ミリ秒待って検索し、応答待ちにも上限を設ける。 */
export function useWorkspaceSymbols(
	bridge: Bridge | undefined,
	active: boolean,
	query: string,
) {
	const term = query.trim();
	const [result, setResult] = useState<{
		query: string;
		data: WorkspaceSymbolsResult;
	} | null>(null);
	useEffect(() => {
		setResult(null);
		if (!active || !bridge || !term || !isSymbolQuery(term)) {
			return;
		}
		const requestId = crypto.randomUUID();
		let finished = false;
		const complete = (data: WorkspaceSymbolsResult) => {
			if (finished) {
				return;
			}
			finished = true;
			setResult({ query: term, data });
		};
		const unsubscribe = bridge.subscribe((message) => {
			if (
				message.type === "workspace/symbols" &&
				message.requestId === requestId
			) {
				complete(message);
			}
		});
		const timer = setTimeout(
			() =>
				bridge.postMessage({
					type: "workspace/searchSymbols",
					requestId,
					query: term,
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
	}, [bridge, active, term]);
	const data = result?.query === term ? result.data : null;
	const items = symbolCompletionItems(data?.entries ?? []);
	return {
		items,
		empty: emptySymbolMessage(bridge, term, data),
		notice: data?.truncated
			? "先頭100件を表示しています。検索語を絞り込んでください。"
			: undefined,
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
	if (!term) {
		return "シンボル名を入力してください。";
	}
	if (!isSymbolQuery(term)) {
		return "検索語は256文字以内で入力してください。";
	}
	if (!data) {
		return "検索中…";
	}
	return (
		data.error ||
		"候補がありません。検索語や言語拡張の対応を確認してください。"
	);
}
