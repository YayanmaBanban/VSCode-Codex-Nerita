// 会話検索のキーボード操作と、終了後のフォーカス復帰先を管理する。
import {
	useCallback,
	useEffect,
	useRef,
	type EffectCallback,
	type RefObject,
	type Dispatch,
	type SetStateAction,
} from "react";

/** 検索入力のフォーカスと、閉じた後の復帰先を管理する。 */
export function useSearchControls(
	conversation: RefObject<HTMLElement | null>,
	open: boolean,
	setOpen: Dispatch<SetStateAction<boolean>>,
	setQuery: Dispatch<SetStateAction<string>>,
	move: (direction: number) => void,
) {
	const input = useRef<HTMLInputElement>(null);
	const previousFocus = useRef<HTMLElement | null>(null);
	const setInput = useCallback((element: HTMLInputElement | null) => {
		input.current = element;
	}, []);
	const close = useCallback(() => {
		setOpen(false);
		if (previousFocus.current?.isConnected === true) {
			previousFocus.current.focus({ preventScroll: true });
		} else {
			conversation.current?.focus({ preventScroll: true });
		}
		previousFocus.current = null;
	}, [conversation, setOpen]);
	useEffect(
		() =>
			createSearchKeyboardEffect(
				open,
				previousFocus,
				conversation,
				setQuery,
				setOpen,
				input,
				move,
			)(),
		[open, conversation, setQuery, setOpen, move],
	);
	useEffect(() => {
		if (open) {
			input.current?.focus();
			input.current?.select();
		}
	}, [open]);
	return { close, setInput };
}

/** 検索ショートカットを捕捉し、終了時にリスナーを解除する。 */
export function createSearchKeyboardEffect(
	open: boolean,
	previousFocus: RefObject<HTMLElement | null>,
	conversation: RefObject<HTMLElement | null>,
	setQuery: Dispatch<SetStateAction<string>>,
	setOpen: Dispatch<SetStateAction<boolean>>,
	input: RefObject<HTMLInputElement | null>,
	move: (direction: number) => void,
): EffectCallback {
	return () => {
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
			conversation.current?.contains(selection.anchorNode) === true &&
			selection.toString() !== ""
		) {
			setQuery(selection.toString());
		}
	}
}
