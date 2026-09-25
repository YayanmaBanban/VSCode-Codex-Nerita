// Ctrl+F の表示制御と、会話の更新に追従する検索・ハイライトを管理する。
import {
	type SetStateAction,
	type Dispatch,
	useCallback,
	useEffect,
	useRef,
	useState,
	type RefObject,
} from "react";
import { searchPattern, type FindOptions } from "./findMatches";
import { revealMatch, searchRanges } from "./searchRanges";

/** 検索中は本文の DOM を保持し、CSS Highlight で一致箇所だけを強調する。 */
export function useChatSearch(conversation: RefObject<HTMLElement | null>) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<FindOptions>({
		caseSensitive: false,
		wholeWord: false,
		regex: false,
	});
	const [result, setResult] = useState({
		count: 0,
		index: 0,
		limited: false,
		error: "",
	});
	const input = useRef<HTMLInputElement>(null);
	const previousFocus = useRef<HTMLElement | null>(null);
	const ranges = useRef<Range[]>([]);
	const index = useRef(0);
	const close = useCallback(() => {
		setOpen(false);
		previousFocus.current?.focus({ preventScroll: true });
	}, []);
	/** 選択中の一致だけを別色にし、入力欄のカーソルは動かさない。 */
	const select = useCallback(
		(position: number, scroll = true) => {
			index.current = position;
			const range = ranges.current[position];
			CSS.highlights.set(
				"chat-find-current",
				new Highlight(...(range ? [range] : [])),
			);
			if (range && scroll && conversation.current) {
				revealMatch(range, conversation.current);
			}
			setResult((current) => ({ ...current, index: position }));
		},
		[conversation],
	);
	const move = useCallback(
		(direction: number) => {
			const count = ranges.current.length;
			if (count) {
				select((index.current + direction + count) % count);
			}
		},
		[select],
	);
	useEffect(() => {
		/** ブラウザ検索と入力エディターのショートカットより先に処理する。 */
		const onKey = (event: KeyboardEvent) => {
			if (event.isComposing) {
				return;
			}
			if (isOpenSearchKey(event)) {
				event.preventDefault();
				event.stopPropagation();
				initializeSearchQuery(
					open,
					previousFocus,
					conversation,
					setQuery,
				);
				setOpen(true);
				input.current?.focus();
				input.current?.select();
			} else if (isMoveSearchKey(open, event)) {
				event.preventDefault();
				event.stopPropagation();
				move(event.shiftKey ? -1 : 1);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [conversation, move, open]);
	useEffect(() => {
		if (open) {
			input.current?.focus();
			input.current?.select();
		}
	}, [open]);
	useEffect(() => {
		const root = conversation.current;
		if (!open || !root) {
			return;
		}
		/** 再描画時は現在位置を維持し、条件変更時だけ先頭の一致へ移動する。 */
		const update = (reset: boolean) => {
			try {
				const pattern = searchPattern(query, options);
				const found = pattern
					? searchRanges(root, pattern)
					: { ranges: [], limited: false };
				ranges.current = found.ranges;
				const highlight = new Highlight();
				for (const range of found.ranges) {
					highlight.add(range);
				}
				CSS.highlights.set("chat-find-matches", highlight);
				setResult({
					count: found.ranges.length,
					index: 0,
					limited: found.limited,
					error: "",
				});
				select(
					reset
						? 0
						: Math.min(
								index.current,
								Math.max(0, found.ranges.length - 1),
							),
					reset,
				);
			} catch {
				ranges.current = [];
				CSS.highlights.delete("chat-find-matches");
				CSS.highlights.delete("chat-find-current");
				setResult({
					count: 0,
					index: 0,
					limited: false,
					error: "正規表現が正しくありません。",
				});
			}
		};
		update(true);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new MutationObserver(() => {
			// 逐次出力が続いても、一定間隔で検索結果を更新する。
			if (timer !== undefined) {
				return;
			}
			timer = setTimeout(() => {
				timer = undefined;
				update(false);
			}, 120);
		});
		observer.observe(root, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["open", "hidden", "class"],
		});
		return () => {
			observer.disconnect();
			clearTimeout(timer);
			ranges.current = [];
			CSS.highlights.delete("chat-find-matches");
			CSS.highlights.delete("chat-find-current");
		};
	}, [conversation, open, options, query, select]);
	return {
		open,
		query,
		setQuery,
		options,
		setOptions,
		result,
		input,
		close,
		move,
	};
}

/** 検索中の一致箇所を移動するショートカットを判定する。 */
function isMoveSearchKey(open: boolean, event: KeyboardEvent) {
	return (
		open &&
		(event.key === "F3" ||
			((event.ctrlKey || event.metaKey) &&
				event.key.toLowerCase() === "g"))
	);
}

/** 会話内検索を開くショートカットを判定する。 */
function isOpenSearchKey(event: KeyboardEvent) {
	return (
		(event.ctrlKey || event.metaKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.toLowerCase() === "f"
	);
}

/** 検索を初めて開く時だけ選択文字列と復帰先を保存する。 */
function initializeSearchQuery(
	open: boolean,
	previousFocus: RefObject<HTMLElement | null>,
	conversation: RefObject<HTMLElement | null>,
	setQuery: Dispatch<SetStateAction<string>>,
) {
	if (!open) {
		previousFocus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const selection = window.getSelection();
		if (
			selection?.anchorNode &&
			conversation.current?.contains(selection.anchorNode) &&
			selection.toString()
		) {
			setQuery(selection.toString());
		}
	}
}
