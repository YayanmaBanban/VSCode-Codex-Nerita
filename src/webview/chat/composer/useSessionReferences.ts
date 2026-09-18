// セッション候補を履歴パネルと独立して検索し、次ページを明示操作で取得する。
import { useEffect, useState } from "react";
import type { Bridge } from "../../vscodeBridge";
import type {
	SessionReference,
	SessionReferencesResult,
} from "../../../shared/sessionReferences";
import { sessionCompletionItems } from "./completions";

/** 古い検索・閉じたメニューへの応答を捨て、同名の会話はIDで区別する。 */
export function useSessionReferences(
	bridge: Bridge | undefined,
	active: boolean,
	query: string,
) {
	const term = query.trim();
	const [page, setPage] = useState<{ query: string; cursor?: string }>({
		query: "",
	});
	const [result, setResult] = useState<{
		query: string;
		entries: SessionReference[];
		nextCursor: string | null;
		seen: string[];
		error?: string;
	} | null>(null);
	const [loading, setLoading] = useState(false);
	const cursor = page.query === term ? page.cursor : undefined;
	// 前に検索した語へ戻った場合も、保存済みの次ページから始めない。
	useEffect(() => {
		setPage({ query: term });
	}, [term, active]);
	useEffect(() => {
		if (!active) {
			setPage({ query: "" });
			setResult(null);
			setLoading(false);
			return;
		}
		if (!bridge || term.length > 256) {
			setResult(null);
			setLoading(false);
			return;
		}
		if (!cursor) {
			setResult(null);
		}
		setLoading(true);
		const requestId = crypto.randomUUID();
		let finished = false;
		const complete = (message: SessionReferencesResult) => {
			if (finished) {
				return;
			}
			finished = true;
			setLoading(false);
			setResult((previous) => {
				const old =
					cursor && previous?.query === term ? previous : null;
				const repeated =
					message.nextCursor !== null &&
					(message.nextCursor === cursor ||
						old?.seen.includes(message.nextCursor));
				return {
					query: term,
					entries: [
						...new Map(
							[...(old?.entries ?? []), ...message.entries].map(
								(entry) => [entry.sessionId, entry],
							),
						).values(),
					],
					nextCursor: repeated ? null : message.nextCursor,
					seen: [...(old?.seen ?? []), ...(cursor ? [cursor] : [])],
					...(message.error || repeated
						? {
								error:
									message.error ||
									"一覧を続けて取得できませんでした。検索し直してください。",
							}
						: {}),
				};
			});
		};
		const unsubscribe = bridge.subscribe((message) => {
			if ("requestId" in message && message.requestId === requestId) {
				if (message.type === "session/references") {
					complete(message);
				} else if (message.type === "request/failed") {
					complete({
						type: "session/references",
						requestId,
						entries: [],
						nextCursor: null,
						error: message.error,
					});
				}
			}
		});
		const timer = setTimeout(
			() =>
				bridge.postMessage({
					type: "session/searchReferences",
					requestId,
					query: term,
					...(cursor ? { cursor } : {}),
				}),
			250,
		);
		const timeout = setTimeout(
			() =>
				complete({
					type: "session/references",
					requestId,
					entries: [],
					nextCursor: null,
					error: "検索がタイムアウトしました。検索し直してください。",
				}),
			15_000,
		);
		return () => {
			finished = true;
			clearTimeout(timer);
			clearTimeout(timeout);
			unsubscribe();
		};
	}, [bridge, active, term, cursor]);
	const data = result?.query === term ? result : null;
	const items = sessionCompletionItems(data?.entries ?? []);
	if (data?.nextCursor && !loading) {
		items.push({
			id: "load-more-sessions",
			label: "さらに読み込む",
			more: true,
		});
	}
	return {
		items,
		empty: !bridge
			? "セッション検索を利用できません。"
			: term.length > 256
				? "検索語は256文字以内で入力してください。"
				: loading || !data
					? "読み込み中…"
					: data.error || "参照できるセッションがありません。",
		notice:
			data?.error ||
			(loading && data?.entries.length
				? "読み込み中…"
				: "同じ作業フォルダーのセッションを参照します。"),
		more: () => {
			if (data?.nextCursor && !loading) {
				setPage({ query: term, cursor: data.nextCursor });
			}
		},
	};
}
