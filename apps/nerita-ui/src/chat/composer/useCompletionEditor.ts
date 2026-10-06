// 候補表示の検出と Tab 操作を Lexical へ登録し、解除時に購読も解除する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";

import {
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	KEY_DOWN_COMMAND,
	mergeRegister,
	type LexicalEditor,
} from "lexical";
import { useLayoutEffect, useEffect, useRef, type RefObject } from "react";
import { $completion, $insertCompletion, type Completion } from "./completions";
import { $pointOffset } from "./content";

/** 本文のカーソル直前に2スペースを挿入、または最大2スペースを削除する。 */
function $indent(event: KeyboardEvent, editor: LexicalEditor): boolean {
	if (ignoreIndentKey(event, editor)) {
		return false;
	}
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		return false;
	}
	event.preventDefault();
	if (!event.shiftKey) {
		selection.insertText("  ");
	} else if (selection.isCollapsed()) {
		const block = selection.anchor.getNode().getTopLevelElement();
		if (block) {
			const end = $pointOffset(selection.anchor, block);
			const spaces =
				/ {1,2}$/.exec(block.getTextContent().slice(0, end))?.[0]
					.length ?? 0;
			if (isNonZeroNumber(spaces)) {
				$insertCompletion(
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
	return (
		event.key !== "Tab" ||
		event.isComposing ||
		// IME の確定時に isComposing が先に解除されても、確定キーを処理しない。
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		event.keyCode === 229 ||
		editor.isComposing() ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey
	);
}

/** React 側の最新状態を参照し、検索欄への移動でも本文の置換範囲を保つ。 */
export function useCompletionEditor(
	editor: LexicalEditor,
	options: {
		match: Completion | null;
		dismissed: RefObject<string>;
		container: RefObject<HTMLDivElement | null>;
		onMatch: (match: Completion | null) => void;
		handleKey: (event: KeyboardEvent) => boolean;
		id: string;
		selected: number | null;
	},
) {
	const latest = useRef(options);
	useLayoutEffect(() => {
		latest.current = options;
	}, [options]);
	useEffect(() => registerCompletionCommands(editor, latest), [editor]);
	useEffect(() => {
		const outside = (event: Event) => {
			// 初回表示中の検索欄へのフォーカスを、パネル外への移動と判定しない。
			if (
				latest.current.container.current &&
				event.target instanceof Node &&
				!latest.current.container.current.contains(event.target) &&
				!(editor.getRootElement()?.contains(event.target) === true)
			) {
				latest.current.onMatch(null);
			}
		};
		document.addEventListener("mousedown", outside);
		document.addEventListener("focusin", outside);
		return () => {
			document.removeEventListener("mousedown", outside);
			document.removeEventListener("focusin", outside);
		};
	}, [editor]);
	useEffect(() => {
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
	}, [editor, options.match, options.id, options.selected]);
}

/** 本文の補完検出とキー操作を登録し、それらをまとめて解除する関数を返す。 */
function registerCompletionCommands(
	editor: LexicalEditor,
	latest: RefObject<{
		match: Completion | null;
		dismissed: RefObject<string>;
		container: RefObject<HTMLDivElement | null>;
		onMatch: (match: Completion | null) => void;
		handleKey: (event: KeyboardEvent) => boolean;
		id: string;
		selected: number | null;
	}>,
): () => void {
	return mergeRegister(
		editor.registerUpdateListener(({ editorState }) => {
			const current = latest.current;
			if (
				current.match &&
				!editorState.read(() => $getNodeByKey(current.match!.key))
			) {
				current.onMatch(null);
				return;
			}
			if (
				!(
					editor
						.getRootElement()
						?.contains(document.activeElement) === true
				) ||
				editor.isComposing()
			) {
				return;
			}
			const next = editorState.read($completion);
			if (!next) {
				current.dismissed.current = "";
			}
			if (
				JSON.stringify(next) === current.dismissed.current ||
				JSON.stringify(next) === JSON.stringify(current.match)
			) {
				return;
			}
			current.dismissed.current = "";
			current.onMatch(next);
		}),
		editor.registerCommand(
			KEY_DOWN_COMMAND,
			(event) =>
				latest.current.handleKey(event) || $indent(event, editor),
			COMMAND_PRIORITY_CRITICAL,
		),
	);
}
