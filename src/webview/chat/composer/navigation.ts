// 通常文と貼り付けブロックの境界で上下キーの移動先を揃える。
import {
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	type LexicalEditor,
} from "lexical";
import { PastedBlockNode } from "./PastedBlockNode";
import { $pointOffset, $selectOffset } from "./content";

/** 折り返された通常文では、実際の表示上の先頭行・最終行を判定する。 */
function atVisualEdge(element: HTMLElement, up: boolean): boolean {
	const selection = window.getSelection();
	if (!selection?.rangeCount) {
		return false;
	}
	const caret = selection.getRangeAt(0).getBoundingClientRect();
	const range = document.createRange();
	range.selectNodeContents(element);
	const rects = Array.from(range.getClientRects()).filter(
		(rect) => rect.height > 0,
	);
	const edge = up ? rects[0] : rects[rects.length - 1];
	return !edge || caret.height === 0 || Math.abs(caret.top - edge.top) < 4;
}

/** 境界でのみ移動を補助し、範囲選択と行内の標準移動を保つ。 */
export function $moveAcrossBlock(
	editor: LexicalEditor,
	event: KeyboardEvent,
	up: boolean,
): boolean {
	const selection = $getSelection();
	if (
		!$isRangeSelection(selection) ||
		!selection.isCollapsed() ||
		event.shiftKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.isComposing ||
		editor.isComposing()
	) {
		return false;
	}
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block) {
		return false;
	}
	const offset = $pointOffset(selection.anchor, block);
	const text = block.getTextContent();
	const adjacent = up ? block.getPreviousSibling() : block.getNextSibling();
	if (
		!$isElementNode(adjacent) ||
		(!(block instanceof PastedBlockNode) &&
			!(adjacent instanceof PastedBlockNode))
	) {
		return false;
	}
	if (
		up
			? text.slice(0, offset).includes("\n")
			: text.slice(offset).includes("\n")
	) {
		return false;
	}
	const element = editor.getElementByKey(block.getKey());
	if (
		!(block instanceof PastedBlockNode) &&
		element &&
		!atVisualEdge(element, up)
	) {
		return false;
	}
	event.preventDefault();
	const column = offset - text.slice(0, offset).lastIndexOf("\n") - 1;
	const target = adjacent.getTextContent();
	const start = up ? target.lastIndexOf("\n") + 1 : 0;
	const end = up
		? target.length
		: target.indexOf("\n") < 0
			? target.length
			: target.indexOf("\n");
	$selectOffset(adjacent, Math.min(start + column, end));
	return true;
}
