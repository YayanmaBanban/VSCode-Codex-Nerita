// 候補表示の検出と Tab 操作を Lexical へ登録し、解除時に購読も解除する。
import { composingCompletion } from "./completionKeyboard";
/** 外部へ登録したコールバックから最新値を参照するための可変の参照先。 */
type Reference<T> = { current: T };
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";

import {
	$getNodeByKey as getNodeByKey,
	$getSelection as getSelection,
	$isRangeSelection as isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	KEY_DOWN_COMMAND,
	mergeRegister,
	type LexicalEditor,
} from "lexical";
import {
	$completion as completion,
	$insertCompletion as insertCompletion,
	type Completion,
} from "./completions";
import { $pointOffset as pointOffset } from "./content";

/** 本文のカーソル直前に2スペースを挿入、または最大2スペースを削除する。 */
function indent(event: KeyboardEvent, editor: LexicalEditor): boolean {
	if (ignoreIndentKey(event, editor)) {
		return false;
	}
	const selection = getSelection();
	if (!isRangeSelection(selection)) {
		return false;
	}
	event.preventDefault();
	if (!event.shiftKey) {
		selection.insertText("  ");
	} else if (selection.isCollapsed()) {
		const block = selection.anchor.getNode().getTopLevelElement();
		if (block) {
			const end = pointOffset(selection.anchor, block);
			const spaces =
				/ {1,2}$/.exec(block.getTextContent().slice(0, end))?.[0]
					.length ?? 0;
			if (isNonZeroNumber(spaces)) {
				insertCompletion(
					{
						key: block.getKey(),
						start: end - spaces,
						end,
						marker: "",
						query: "",
					},
					"",
				);
			}
		}
	}
	return true;
}

/** 通常の Tab 入力だけを字下げ操作として受け付ける。 */
function ignoreIndentKey(event: KeyboardEvent, editor: LexicalEditor) {
	const ignoredTab =
		event.key !== "Tab" || composingCompletion(event, editor);
	if (ignoredTab || event.ctrlKey) {
		return true;
	}
	return event.metaKey || event.altKey;
}

/** Svelte の getter から最新状態を参照し、検索欄への移動でも本文の置換範囲を保つ。 */
export function useCompletionEditor(
	editor: LexicalEditor,
	options: {
		match: Completion | null;
		dismissed: Reference<string>;
		container: Reference<HTMLDivElement | null>;
		onMatch: (match: Completion | null) => void;
		handleKey: (event: KeyboardEvent) => boolean;
		id: string;
		selected: number | null;
	},
) {
	const latest = { current: options };
	// Lexical の更新とキー操作を画面の寿命に結び付け、破棄時に購読を解除する。
	$effect(() => registerCompletionCommands(editor, latest));
	// この controller が持つ補完パネルの外側操作を捕捉し、破棄時に document の監視を外す。
	$effect(() => {
		/** 入力欄と補完パネルの両方から離れた操作だけで補完を閉じ、初回のフォーカス移動は維持する。 */
		const outside = (event: Event) => {
			// 初回表示中の検索欄へのフォーカスを、パネル外への移動と判定しない。
			const outsideCompletion =
				latest.current.container.current &&
				event.target instanceof Node &&
				!latest.current.container.current.contains(event.target);
			const matchesOutsideCompletion =
				outsideCompletion === true &&
				!(editor.getRootElement()?.contains(event.target) === true);
			if (matchesOutsideCompletion) {
				latest.current.onMatch(null);
			}
		};
		document.addEventListener("mousedown", outside);
		document.addEventListener("focusin", outside);
		return () => {
			document.removeEventListener("mousedown", outside);
			document.removeEventListener("focusin", outside);
		};
	});
	// 候補と選択の変化を、Lexical が所有する root の ARIA 属性へ同期する。
	$effect(() => {
		const root = editor.getRootElement();
		if (options.match && root) {
			root.setAttribute("aria-controls", options.id);
			root.setAttribute("aria-autocomplete", "list");
			if (options.selected !== null) {
				root.setAttribute(
					"aria-activedescendant",
					`${options.id}-${options.selected}`,
				);
			}
		}
		return () => {
			for (const name of [
				"aria-controls",
				"aria-autocomplete",
				"aria-activedescendant",
			]) {
				root?.removeAttribute(name);
			}
		};
	});
}

/** 本文の補完検出とキー操作を登録し、それらをまとめて解除する関数を返す。 */
function registerCompletionCommands(
	editor: LexicalEditor,
	latest: Reference<{
		match: Completion | null;
		dismissed: Reference<string>;
		container: Reference<HTMLDivElement | null>;
		onMatch: (match: Completion | null) => void;
		handleKey: (event: KeyboardEvent) => boolean;
		id: string;
		selected: number | null;
	}>,
): () => void {
	/** 候補の対象が消えた場合は閉じ、フォーカスと IME を確認して候補を再計算する。 */
	const updateCompletionMatch: Parameters<
		typeof editor.registerUpdateListener
	>[0] = ({ editorState }) => {
		const current = latest.current;
		const missingMatchNode =
			current.match &&
			!editorState.read(() => getNodeByKey(current.match!.key));
		if (missingMatchNode === true) {
			current.onMatch(null);
			return;
		}

		const editorIsUnfocused = !(
			editor.getRootElement()?.contains(document.activeElement) === true
		);
		if (editorIsUnfocused) {
			return;
		}
		if (editor.isComposing()) {
			return;
		}
		const next = editorState.read(completion);
		if (!next) {
			current.dismissed.current = "";
		}
		const matchesStringify =
			JSON.stringify(next) === current.dismissed.current ||
			JSON.stringify(next) === JSON.stringify(current.match);
		if (matchesStringify) {
			return;
		}
		current.dismissed.current = "";
		current.onMatch(next);
	};
	return mergeRegister(
		editor.registerUpdateListener(updateCompletionMatch),
		editor.registerCommand(
			KEY_DOWN_COMMAND,
			(event) => latest.current.handleKey(event) || indent(event, editor),
			COMMAND_PRIORITY_CRITICAL,
		),
	);
}
