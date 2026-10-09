// 仮想化した会話の元データを検索し、画面外の一致へも移動する。
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import type { MessageTimeline } from "../messages/messageTimeline";
import type { ConversationVirtualizer } from "../messages/useConversationVirtualizer";
import type { ToolExpansionState } from "../tools/ToolExpansion";
import { searchPattern, type FindOptions } from "./findMatches";
import { useSearchControls } from "./searchKeyboard";
import { searchTimeline, type SearchHit } from "./searchTimeline";
import { useSearchHighlights } from "./useSearchHighlights";

/** 検索件数と選択位置、上限到達・入力エラーをまとめた表示状態。 */
type SearchResult = {
	count: number;
	index: number;
	limited: boolean;
	error: string;
};

/** 検索中も仮想化を維持し、選択した一致箇所の行へ移動する。 */
export function useChatSearch(
	conversation: RefObject<HTMLElement | null>,
	timeline: MessageTimeline,
	virtual: ConversationVirtualizer,
	expansion: ToolExpansionState,
) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<FindOptions>({
		caseSensitive: false,
		wholeWord: false,
		regex: false,
	});
	const [found, setFound] = useState<SearchData>({
		hits: [],
		pattern: null,
		limited: false,
		error: "",
	});
	const { index, setIndex, selection, reveal, move } = useSearchNavigation(
		found.hits,
		virtual,
	);
	const { close, setInput } = useSearchControls(
		conversation,
		open,
		setOpen,
		setQuery,
		move,
	);
	useSearchData(open, query, options, timeline, setFound, setIndex, reveal);
	const active = found.hits[index];
	useSelectedHit(
		open,
		active,
		timeline,
		virtual,
		expansion,
		reveal,
		selection,
	);
	useSearchHighlights(
		conversation,
		open,
		found.pattern,
		active,
		reveal,
		selection,
	);
	const result: SearchResult = {
		count: found.hits.length,
		index,
		limited: found.limited,
		error: found.error,
	};
	return {
		open,
		query,
		setQuery,
		options,
		setOptions,
		result,
		setInput,
		close,
		move,
	};
}

/** 元データ検索の結果。正規表現は描画済みの行の強調にも共用する。 */
type SearchData = {
	hits: SearchHit[];
	pattern: RegExp | null;
	limited: boolean;
	error: string;
};

/** 入力をまとめて処理し、データの更新時は選択位置を維持する。 */
function useSearchData(
	open: boolean,
	query: string,
	options: FindOptions,
	timeline: MessageTimeline,
	setFound: (value: SearchData) => void,
	setIndex: (update: (index: number) => number) => void,
	reveal: RefObject<boolean>,
) {
	const previous = useRef({ query, options });
	useEffect(() => {
		if (!open) {
			setFound({ hits: [], pattern: null, limited: false, error: "" });
			return;
		}
		const reset =
			previous.current.query !== query ||
			previous.current.options !== options;
		const timer = setTimeout(
			() => {
				try {
					previous.current = { query, options };
					const pattern = searchPattern(query, options);
					const result = pattern
						? searchTimeline(timeline.entries, pattern)
						: { hits: [], limited: false };
					setFound({ ...result, pattern, error: "" });
					setIndex(searchIndex(reset, result.hits.length));
					reveal.current = reset;
				} catch {
					setFound({
						hits: [],
						pattern: null,
						limited: false,
						error: "正規表現が正しくありません。",
					});
				}
			},
			reset ? 250 : 120,
		);
		return () => clearTimeout(timer);
	}, [open, query, options, timeline, setFound, setIndex, reveal]);
}

/** 条件変更時は先頭へ戻し、逐次出力では現在の一致番号を保つ。 */
function searchIndex(reset: boolean, count: number) {
	return (index: number) =>
		reset ? 0 : Math.min(index, Math.max(0, count - 1));
}

/** 選択した画面外の行を描画し、本文への一致ならカードも開く。 */
function useSelectedHit(
	open: boolean,
	active: SearchHit | undefined,
	timeline: MessageTimeline,
	virtual: ConversationVirtualizer,
	expansion: ToolExpansionState,
	reveal: RefObject<boolean>,
	selection: number,
) {
	useEffect(() => {
		if (open && active && reveal.current) {
			const entry =
				timeline.entries[
					timeline.indexByKey.get(active.entryKey) ?? -1
				];
			if (
				active.body &&
				entry?.kind === "tool" &&
				!expansion.open.has(entry.key)
			) {
				expansion.setOpen(entry.tool, true);
			}
			virtual.reveal(active.entryKey);
		}
	}, [open, active, timeline, virtual, expansion, selection, reveal]);
}

/** 一致番号を循環させ、同じ一致への再移動も描画後の強調へ通知する。 */
function useSearchNavigation(
	hits: SearchHit[],
	virtual: ConversationVirtualizer,
) {
	const [index, setIndex] = useState(0);
	const [selection, setSelection] = useState(0);
	const reveal = useRef(false);
	const select = useCallback(
		(position: number) => {
			setIndex(position);
			setSelection((current) => current + 1);
			const hit = hits[position];
			if (!hit) {
				return;
			}
			reveal.current = true;
			virtual.reveal(hit.entryKey);
		},
		[hits, virtual],
	);
	const move = useCallback(
		(direction: number) => {
			if (hits.length > 0) {
				select((index + direction + hits.length) % hits.length);
			}
		},
		[hits.length, index, select],
	);
	return { index, setIndex, selection, reveal, move };
}
