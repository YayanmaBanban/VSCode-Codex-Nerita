// Lexical本文のトリガー検出と、選択候補による範囲置換を担当する。
import {
	$getSelection,
	$isRangeSelection,
	$getNodeByKey,
	$isElementNode,
	$createTextNode,
	$addUpdateTag,
	HISTORY_PUSH_TAG,
} from "lexical";
import type { ComposerTarget } from "../../../shared/composerTargets";
import { $pointOffset, $selectOffset } from "./content";
import { PastedBlockNode } from "./PastedBlockNode";
import { $createPathReferenceNode } from "./PathReferenceNode";

/** トリガー文字を含む置換範囲と候補検索の状態。 */
export type Completion = {
	key: string;
	start: number;
	end: number;
	marker: string;
	query: string;
};

/** 行頭の/・@、任意位置の#をカーソル直前から検出する。 */
export function $completion(): Completion | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block || block instanceof PastedBlockNode) {
		return null;
	}
	const end = $pointOffset(selection.anchor, block);
	const before = block.getTextContent().slice(0, end);
	const match = /(?:^|\n)([/@])([^\s#/@]*)$|(#)([^\s#]*)$/.exec(before);
	if (!match) {
		return null;
	}
	const marker = match[1] ?? match[3]!;
	const query = match[2] ?? match[4]!;
	return {
		key: block.getKey(),
		start: end - query.length - 1,
		end,
		marker,
		query,
	};
}

/** トリガーと検索文字だけを置き換え、カーソル後方の本文を残す。 */
export function $insertCompletion(
	match: Completion,
	text: string,
	reference?: ComposerTarget,
): void {
	const block = $getNodeByKey(match.key);
	if (!$isElementNode(block)) {
		return;
	}
	$selectOffset(block, match.end);
	const end = $getSelection();
	if (!$isRangeSelection(end)) {
		return;
	}
	const point = {
		key: end.anchor.key,
		offset: end.anchor.offset,
		type: end.anchor.type,
	};
	$selectOffset(block, match.start);
	const range = $getSelection();
	if (!$isRangeSelection(range)) {
		return;
	}
	range.focus.set(point.key, point.offset, point.type);
	if (reference) {
		$addUpdateTag(HISTORY_PUSH_TAG);
		const space = $createTextNode(" ");
		range.insertNodes([$createPathReferenceNode(reference), space]);
		space.selectEnd();
	} else {
		range.insertText(text);
	}
}
