// 候補表示の検出とTab操作をLexicalへ登録し、解除時に購読を回収する。
import { useEffect, useRef, type RefObject } from "react";
import {
	$getSelection,
	$isRangeSelection,
	$getNodeByKey,
	COMMAND_PRIORITY_CRITICAL,
	KEY_DOWN_COMMAND,
	mergeRegister,
	type LexicalEditor,
} from "lexical";
import { $pointOffset } from "./content";
import { $completion, $insertCompletion, type Completion } from "./completions";

/** 本文のカーソル直前に2スペースを挿入、または最大2スペースを削除する。 */
function $indent(event: KeyboardEvent, editor: LexicalEditor): boolean {
	if (
		event.key !== "Tab" ||
		event.isComposing ||
		event.keyCode === 229 ||
		editor.isComposing() ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey
	) {
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
			if (spaces) {
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

/** React側の最新状態を参照し、検索欄への移動でも本文の置換範囲を保つ。 */
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
	latest.current = options;
	useEffect(
		() =>
			mergeRegister(
				editor.registerUpdateListener(({ editorState }) => {
					const current = latest.current;
					if (
						current.match &&
						!editorState.read(() =>
							$getNodeByKey(current.match!.key),
						)
					) {
						current.onMatch(null);
						return;
					}
					if (
						!editor
							.getRootElement()
							?.contains(document.activeElement) ||
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
						latest.current.handleKey(event) ||
						$indent(event, editor),
					COMMAND_PRIORITY_CRITICAL,
				),
			),
		[editor],
	);
	useEffect(() => {
		const outside = (event: Event) => {
			if (
				event.target instanceof Node &&
				!latest.current.container.current?.contains(event.target) &&
				!editor.getRootElement()?.contains(event.target)
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
