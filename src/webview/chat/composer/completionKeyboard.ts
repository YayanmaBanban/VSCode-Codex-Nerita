// 候補一覧のキー操作を本文・検索欄で共有し、IME確定を選択として扱わない。
import type { LexicalEditor } from "lexical";
import type { Completion } from "./completions";
import type { CompletionItem } from "./completionItems";

type CompletionKeyboardOptions = {
	editor: LexicalEditor;
	match: Completion | null;
	category: string;
	items: CompletionItem[];
	index: number;
	close: () => void;
	back: () => void;
	pick: (item: CompletionItem) => void;
	setSelected: (index: number) => void;
};

/** trueを返したキーだけ呼び出し元で伝播を止め、通常の編集操作を残す。 */
export function handleCompletionKey(
	event: KeyboardEvent,
	options: CompletionKeyboardOptions,
	inSearch = false,
): boolean {
	const { editor, match, category, close, back } = options;

	if (composingCompletion(event, editor)) {
		return false;
	}
	if (!match || event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		close();
		editor.focus();
		return true;
	}
	if (backFromCategory(event, category, inSearch)) {
		event.preventDefault();
		back();
		return true;
	}
	return handleCompletionSelection(event, options);
}

/** 本文からカテゴリの親へ戻るキーを判定する。 */
function backFromCategory(
	event: KeyboardEvent,
	category: string,
	inSearch: boolean,
) {
	return event.key === "ArrowLeft" && category && !inSearch;
}

/** IME入力中のキーを候補操作から除外する。 */
function composingCompletion(event: KeyboardEvent, editor: LexicalEditor) {
	return event.isComposing || event.keyCode === 229 || editor.isComposing();
}

/** 候補一覧の上下移動と確定を処理する。 */
function handleCompletionSelection(
	event: KeyboardEvent,
	options: CompletionKeyboardOptions,
): boolean {
	const { items, index, pick, setSelected } = options;
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		setSelected(
			items.length
				? (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
						items.length
				: 0,
		);
		return true;
	}
	if (isCompletionSelectionKey(event, items, index)) {
		event.preventDefault();
		if (items[index]) {
			pick(items[index]);
		}
		return true;
	}
	return false;
}

/** 修飾キーを考慮して候補を確定するキーを判定する。 */
function isCompletionSelectionKey(
	event: KeyboardEvent,
	items: CompletionItem[],
	index: number,
) {
	return (
		(event.key === "Enter" ||
			event.key === "Tab" ||
			(event.key === "ArrowRight" &&
				(items[index]?.category || items[index]?.directory))) &&
		!event.shiftKey
	);
}
