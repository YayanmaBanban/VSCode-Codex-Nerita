// セッション候補を履歴パネルと独立して検索し、次ページを明示操作で取得する。
type SetStateAction<T> = T | ((previous: T) => T);
/** 状態の更新要求を受け取る通知関数。呼び出し元は戻り値を利用しない。 */
type Dispatch<T> = (value: T) => void;
/** 購読や外部操作を登録し、必要なら破棄時の解除処理を返す。 */
type EffectSetup = () => void | (() => void);
import {
	isNonEmptyString,
	isNonZeroNumber,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";

import type { HostMessage } from "@nerita/shared/messages";

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
/** 会話の参照候補を検索する。Svelte の寿命管理内で呼び出し、検索条件を最新値で渡し、追加ページは明示的に要求する。 */
export function useSessionReferences(input: {
	bridge: Bridge | undefined;
	active: boolean;
	query: string;
	mode: SessionReference["mode"];
}) {
	const bridge = $derived(input.bridge);
	const active = $derived(input.active);
	const query = $derived(input.query);
	const mode = $derived(input.mode);

	const term = $derived(query.trim());
	// ページ送りで上書きしても、検索語が変われば先頭ページへ戻す。
	let page = $derived<{ query: string; cursor?: string }>({
		query: term,
	});
	/** 検索語と次のページのカーソルを保持し、別の検索結果を混ぜない。 */
	const setPage = (
		value: typeof page | ((previous: typeof page) => typeof page),
	) => {
		page = typeof value === "function" ? value(page) : value;
	};
	let result = $state.raw<SessionReferencePage | null>(null);
	/** 会話候補の取得結果を、直接値または前のページからの更新で保持する。 */
	const setResult = (
		value: typeof result | ((previous: typeof result) => typeof result),
	) => {
		result = typeof value === "function" ? value(result) : value;
	};
	let loading = $state.raw(false);
	/** 会話候補の取得中かどうかを、直接値または更新処理で切り替える。 */
	const setLoading = (
		value: typeof loading | ((previous: typeof loading) => typeof loading),
	) => {
		loading = typeof value === "function" ? value(loading) : value;
	};
	const cursor = $derived(page.query === term ? page.cursor : undefined);
	// 検索条件の変更で旧要求のタイマーと購読を解除し、非同期の候補取得を開始する。
	$effect(() =>
		createSessionReferenceSearch(
			active,
			setPage,
			setResult,
			setLoading,
			bridge,
			term,
			cursor,
		)(),
	);
	const data = $derived(result?.query === term ? result : null);
	const items = $derived.by(() => {
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
		return items;
	});
	return {
		get items() {
			return items;
		},
		get empty() {
			return emptySessionMessage(bridge, term, loading, data);
		},
		get notice() {
			return sessionReferenceNotice(data, loading);
		},
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
): EffectSetup {
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
		/** 応答を一度だけ確定し、要求した検索語とカーソルに対応するページとして統合する。 */
		const complete = (message: SessionReferencesResult) => {
			if (finished) {
				return;
			}
			finished = true;
			setLoading(false);
			setResult(mergeSessionReferencePage(cursor, term, message));
		};
		/** 検索要求 ID を照合し、失敗も同じ検索の完了として待機を解除する。 */
		const receiveReferenceSearch: Parameters<
			NonNullable<typeof bridge>["subscribe"]
		>[0] = (message) =>
			receiveSessionReferenceReply(message, requestId, complete);
		const unsubscribe = bridge.subscribe(receiveReferenceSearch);
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
	const matchesNextCursor =
		message.nextCursor !== null &&
		(message.nextCursor === cursor ||
			old?.seen.includes(message.nextCursor));
	return matchesNextCursor;
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
	const loadingEntries = loading && isNonZeroNumber(data?.entries.length);
	return (
		nonEmptyString(data?.error) ??
		(loadingEntries
			? "読み込み中…"
			: "同じ作業フォルダのセッションを参照します。")
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

/** 現在の検索への応答だけを受け取り、失敗も一覧取得の終了として通知する。 */
function receiveSessionReferenceReply(
	message: HostMessage,
	requestId: string,
	complete: (message: SessionReferencesResult) => void,
): void {
	if (!("requestId" in message)) {
		return;
	}
	if (message.requestId !== requestId) {
		return;
	}
	if (message.type === "session/references") {
		complete(message);
		return;
	}
	if (message.type === "request/failed") {
		complete({
			type: "session/references",
			requestId,
			entries: [],
			nextCursor: null,
			error: message.error,
		});
	}
}
