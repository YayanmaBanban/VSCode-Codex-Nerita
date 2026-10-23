// 選択範囲をブロックへ置換し、前後の本文と参照を保持する。
import {
	$createParagraphNode,
	$generateNodesFromRawText,
	$getRoot,
	$getSelection,
	$isRangeSelection,
} from "lexical";
import { $createPastedBlockNode } from "./PastedBlockNode";
import { $pointOffset } from "./content";
import { $appendInlineContent, $readReferences } from "./inlineReferences";

/** 現在の選択だけを置換し、後続の通常段落へカーソルを戻す。 */
export function $insertPastedBlock(text: string): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		return;
	}
	selection.removeText();
	const active = $getSelection();
	if (!$isRangeSelection(active)) {
		return;
	}
	const before =
		active.anchor.getNode().getTopLevelElement() ?? $createParagraphNode();
	if (!before.isAttached()) {
		$getRoot().append(before);
	}
	const offset = $pointOffset(active.anchor, before);
	const original = before.getTextContent();
	const references = $readReferences(before);
	const block = $createPastedBlockNode().append(
		...$generateNodesFromRawText(text),
	);
	const after = $createParagraphNode();
	$appendInlineContent(after, original, references, offset);
	$appendInlineContent(before.clear(), original, references, 0, offset);
	before.insertAfter(block);
	block.insertAfter(after);
	after.selectStart();
}
