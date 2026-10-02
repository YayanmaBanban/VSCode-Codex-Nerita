// 標準コンテキストメニューへ選択状態を渡し、Host からの変換要求を処理する。

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Bridge } from "@nerita/shared/bridge";
import {
	$addUpdateTag,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	$setSelection,
	HISTORY_PUSH_TAG,
	type LexicalEditor,
	mergeRegister,
	type RangeSelection,
} from "lexical";
import { useEffect } from "react";
import { PathReferenceNode } from "./PathReferenceNode";
import { $pointOffset, $readParts } from "./content";
import { $insertPastedBlock } from "./insertPastedBlock";

/** 通常段落だけの選択を読み、段落間を送信本文と同じ1文字の改行でつなぐ。 */
function $selectedPlainText(selection: RangeSelection): string | null {
	if (selection.isCollapsed()) {
		return null;
	}
	const [start, end] = selection.isBackward()
		? [selection.focus, selection.anchor]
		: [selection.anchor, selection.focus];
	const first = start.getNode().getTopLevelElement();
	const last = end.getNode().getTopLevelElement();
	if (
		!$isParagraphNode(first) ||
		!$isParagraphNode(last) ||
		selection.getNodes().some((node) => node instanceof PathReferenceNode)
	) {
		return null;
	}
	const siblings = first.getParentOrThrow().getChildren();
	const paragraphs = siblings.slice(
		siblings.indexOf(first),
		siblings.indexOf(last) + 1,
	);
	if (paragraphs.some((node) => !$isParagraphNode(node))) {
		return null;
	}
	return paragraphs
		.map((node) =>
			node
				.getTextContent()
				.slice(
					node === first ? $pointOffset(start, first) : 0,
					node === last ? $pointOffset(end, last) : undefined,
				),
		)
		.join("\n");
}

/** Host からコードブロックへの変換要求を受け取るブリッジ。 */
type CodeBlockMenuPluginProps = {
	bridge?: Bridge | undefined;
};

/** 右クリック時の選択を保持し、一度だけブロックへ変換する。 */
export function CodeBlockMenuPlugin({ bridge }: CodeBlockMenuPluginProps) {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		if (!bridge) {
			return;
		}
		let pending: { id: string; selection: RangeSelection } | undefined;
		/** メニューから戻る間のフォーカス移動では選択を破棄しない。 */
		const clear = () => {
			pending = undefined;
			const root = editor.getRootElement();
			if (root) {
				root.dataset.vscodeContext = JSON.stringify({
					webviewSection: "composer",
					composerCanCodeBlock: false,
				});
			}
		};
		/** VS Code がイベントを受け取る前にメニュー条件と識別子を設定する。 */
		const prepare = () => {
			clear();
			if (!editor.isEditable() || editor.isComposing()) {
				return;
			}
			pending = prepareCodeBlockSelection(editor, pending);
		};
		return mergeRegister(
			editor.registerRootListener((root, previous) => {
				previous?.removeEventListener("contextmenu", prepare);
				previous?.removeAttribute("data-vscode-context");
				root?.addEventListener("contextmenu", prepare);
				clear();
			}),
			editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
				// 本文変更や下書き復元後に、古いノード位置で置換しない。
				if (dirtyElements.size || dirtyLeaves.size) {
					clear();
				}
			}),
			editor.registerEditableListener(clear),
			bridge.subscribe((message) => {
				if (
					message.type !== "ui/codeBlock" ||
					message.requestId !== pending?.id
				) {
					return;
				}
				const saved = pending.selection;
				clear();
				if (!editor.isEditable() || editor.isComposing()) {
					return;
				}
				insertSelectedCodeBlock(editor, saved);
			}),
		);
	}, [bridge, editor]);
	return null;
}

/** 保持した選択が有効な時だけコードブロックへ変換する。 */
function insertSelectedCodeBlock(editor: LexicalEditor, saved: RangeSelection) {
	editor.update(() => {
		const text = $selectedPlainText(saved);
		if (!text?.trim() || $readParts().length >= 201) {
			return;
		}
		$setSelection(saved.clone());
		$addUpdateTag(HISTORY_PUSH_TAG);
		$insertPastedBlock(text);
	});
}

/** 通常段落の選択だけを右クリックメニューの変換対象にする。 */
function prepareCodeBlockSelection(
	editor: LexicalEditor,
	pending: undefined | { id: string; selection: RangeSelection },
) {
	editor.getEditorState().read(() => {
		const selection = $getSelection();
		const root = editor.getRootElement();
		if (
			!root ||
			!$isRangeSelection(selection) ||
			!$selectedPlainText(selection)?.trim() ||
			$readParts().length >= 201
		) {
			return;
		}
		pending = {
			id: crypto.randomUUID(),
			selection: selection.clone(),
		};
		root.dataset.vscodeContext = JSON.stringify({
			webviewSection: "composer",
			composerCanCodeBlock: true,
			composerSelectionId: pending.id,
		});
	});
	return pending;
}
