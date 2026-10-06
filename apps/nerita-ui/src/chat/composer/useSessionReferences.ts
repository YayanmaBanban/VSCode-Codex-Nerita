// セッション候補を履歴パネルと独立して検索し、次ページを明示操作で取得する。
import {
	isNonEmptyString,
	isNonZeroNumber,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";

import {
	type EffectCallback,
	type Dispatch,
	type SetStateAction,
	useEffect,
	useState,
} from "react";

import type { Bridge } from "@nerita/shared/bridge";
import type {
	SessionReference,
	SessionReferencesResult,
} from "@nerita/shared/sessionReferences";

import { sessionCompletionItems } from "./completionItems";

/** 検索語ごとの候補と、重複取得を防ぐページ履歴を保持する。 */
type SessionReferencePage = {
	query: string;
	entries: SessionReference[];
	nextCursor: string | null;
	seen: string[];
	error?: string;
};

/** 古い検索・閉じたメニューへの応答を捨て、同名の会話は ID で区別する。 */
export function useSessionReferences(
	bridge: Bridge | undefined,
	active: boolean,
	query: string,
	mode: SessionReference["mode"],
) {
	const term = query.trim();
	const [page, setPage] = useState<{ query: string; cursor?: string }>({
		query: "",
	});
	const [result, setResult] = useState<SessionReferencePage | null>(null);
	const [loading, setLoading] = useState(false);
	const cursor = page.query === term ? page.cursor : undefined;
	// 前に検索した語へ戻った場合も、保存済みの次ページから始めない。
	useEffect(() => {
		setPage({ query: term });
	}, [term, active]);
	useEffect(
		() =>
			createSessionReferenceSearch(
				active,
				setPage,
				setResult,
				setLoading,
				bridge,
				term,
				cursor,
			)(),
		[bridge, active, term, cursor],
	);
	const data = result?.query === term ? result : null;
	const items = sessionCompletionItems(
		(data?.entries ?? []).map((entry) => ({ ...entry, mode })),
	);
	if (isNonEmptyString(data?.nextCursor) && !loading) {
		items.push({
			id: "load-more-sessions",
			label: "さらに読み込む",
			more: true,
		});
	}
	return {
		items,
		empty: emptySessionMessage(bridge, term, loading, data),
		notice: sessionReferenceNotice(data, loading),
		more: () => {
			if (isNonEmptyString(data?.nextCursor) && !loading) {
				setPage({ query: term, cursor: data.nextCursor });
			}
		},
	};
}

/** 検索の終了時に購読を解除し、遅延実行とタイムアウトのタイマーを取り消す。 */
function createSessionReferenceSearch(
	active: boolean,
	setPage: Dispatch<SetStateAction<{ query: string; cursor?: string }>>,
	setResult: Dispatch<SetStateAction<SessionReferencePage | null>>,
	setLoading: Dispatch<SetStateAction<boolean>>,
	bridge: undefined | Bridge,
	term: string,
	cursor: undefined | string,
): EffectCallback {
	return () => {
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
		if (!isNonEmptyString(cursor)) {
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
			setResult(mergeSessionReferencePage(cursor, term, message));
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
					...(isNonEmptyString(cursor) ? { cursor } : {}),
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
			15000,
		);
		return () => {
			finished = true;
			clearTimeout(timer);
			clearTimeout(timeout);
			unsubscribe();
		};
	};
}

/** 同じ検索語の追加ページだけを以前の結果に統合する。 */
function mergeSessionReferencePage(
	cursor: string | undefined,
	term: string,
	message: SessionReferencesResult,
): SetStateAction<SessionReferencePage | null> {
	return (previous) => {
		const old =
			isNonEmptyString(cursor) && previous?.query === term
				? previous
				: null;
		const repeated = repeatedSessionCursor(message, cursor, old);
		return {
			query: term,
			entries: mergeSessionEntries(old, message),
			nextCursor: repeated === true ? null : message.nextCursor,
			seen: nextSeenCursors(old, cursor),
			...(isNonEmptyString(message.error) || repeated === true
				? {
						error:
							nonEmptyString(message.error) ??
							"一覧を続けて取得できませんでした。検索し直してください。",
					}
				: {}),
		};
	};
}

/** 同じページを再取得する循環カーソルを検出する。 */
function repeatedSessionCursor(
	message: SessionReferencesResult,
	cursor: string | undefined,
	old: SessionReferencePage | null,
) {
	return (
		message.nextCursor !== null &&
		(message.nextCursor === cursor ||
			old?.seen.includes(message.nextCursor))
	);
}

/** 取得済みページのカーソルを記録する。 */
function nextSeenCursors(
	old: SessionReferencePage | null,
	cursor: string | undefined,
): string[] {
	return [
		...(old?.seen ?? []),
		...(isNonEmptyString(cursor) ? [cursor] : []),
	];
}

/** ページ間のセッション候補を ID 単位で統合する。 */
function mergeSessionEntries(
	old: SessionReferencePage | null,
	message: SessionReferencesResult,
): SessionReference[] {
	return [
		...new Map(
			[...(old?.entries ?? []), ...message.entries].map((entry) => [
				entry.sessionId,
				entry,
			]),
		).values(),
	];
}

/** 検索結果のエラーと読み込み状態を表示文へ変換する。 */
function sessionReferenceNotice(
	data: SessionReferencePage | null,
	loading: boolean,
) {
	return (
		nonEmptyString(data?.error) ??
		(loading && isNonZeroNumber(data?.entries.length)
			? "読み込み中…"
			: "同じ作業フォルダーのセッションを参照します。")
	);
}

/** 接続・検索語・取得状態の順にセッション候補がない理由を返す。 */
function emptySessionMessage(
	bridge: Bridge | undefined,
	term: string,
	loading: boolean,
	data: { error?: string } | null,
) {
	if (!bridge) {
		return "セッション検索を利用できません。";
	}
	if (term.length > 256) {
		return "検索語は256文字以内で入力してください。";
	}
	if (loading || !data) {
		return "読み込み中…";
	}
	return nonEmptyString(data.error) ?? "参照できるセッションがありません。";
}
