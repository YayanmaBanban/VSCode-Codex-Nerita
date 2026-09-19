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
	const {
		editor,
		match,
		category,
		items,
		index,
		close,
		back,
		pick,
		setSelected,
	} = options;

	if (event.isComposing || event.keyCode === 229 || editor.isComposing()) {
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
	if (event.key === "ArrowLeft" && category && !inSearch) {
		event.preventDefault();
		back();
		return true;
	}
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
	if (
		(event.key === "Enter" ||
			event.key === "Tab" ||
			(event.key === "ArrowRight" &&
				(items[index]?.category || items[index]?.directory))) &&
		!event.shiftKey
	) {
		event.preventDefault();
		if (items[index]) {
			pick(items[index]);
		}
		return true;
	}
	return false;
}
