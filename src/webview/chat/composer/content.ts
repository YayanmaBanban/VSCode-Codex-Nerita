// Lexicalの編集状態と、Hostへ保存する下書き断片を相互変換する。
import {
	$createParagraphNode,
	$getRoot,
	$isElementNode,
	$isTextNode,
	type ElementNode,
	type PointType,
} from "lexical";
import type { ComposerPart } from "../../../shared/composerContent";
import { $createPastedBlockNode, PastedBlockNode } from "./PastedBlockNode";
import { $appendInlineContent, $readReferences } from "./inlineReferences";

/** エディタ内部のキーに依存せず、本文とブロック配置の一致を確認する。 */
export function contentKey(parts: ComposerPart[]): string {
	return JSON.stringify(
		parts.map(({ type, text, references }) => [
			type,
			text,
			references ?? [],
		]),
	);
}

/** ブロック境界に余分な改行を加えず、既存の交互配置へ正規化する。 */
export function $readParts(): ComposerPart[] {
	const parts: ComposerPart[] = [
		{ id: "text-start", type: "text", text: "" },
	];
	let previousText = false;
	for (const node of $getRoot().getChildren()) {
		if (node instanceof PastedBlockNode) {
			parts.push(
				{
					id: node.getKey(),
					type: "pasted",
					text: node.getTextContent(),
				},
				{ id: `text-${node.getKey()}`, type: "text", text: "" },
			);
			previousText = false;
		} else {
			const last = parts[parts.length - 1];
			if (last) {
				last.text += previousText ? "\n" : "";
				if ($isElementNode(node)) {
					const references = $readReferences(node, last.text.length);
					if (references.length) {
						last.references = [
							...(last.references ?? []),
							...references,
						];
					}
				}
				last.text += node.getTextContent();
			}
			previousText = true;
		}
	}
	return parts;
}

/** 表示先から復元した下書きを、通常文とブロックの並びに戻す。 */
export function $writeParts(parts: ComposerPart[]): void {
	const root = $getRoot().clear();
	for (const part of parts) {
		const node =
			part.type === "pasted"
				? $createPastedBlockNode()
				: $createParagraphNode();
		$appendInlineContent(node, part.text, part.references);
		root.append(node);
	}
	if (root.isEmpty()) {
		root.append($createParagraphNode());
	}
}

/** カーソルを含む最上位要素内の文字位置を求める。 */
export function $pointOffset(point: PointType, block: ElementNode): number {
	const target = point.getNode();
	let offset = $offsetWithinNode(point, target);
	let current = target;
	while (current !== block) {
		for (const sibling of current.getPreviousSiblings()) {
			offset += sibling.getTextContentSize();
		}
		const parent = current.getParent();
		if (!parent) {
			break;
		}
		current = parent;
	}
	return offset;
}

/** 通常文やブロックの指定文字位置に、単一のカーソルを置く。 */
export function $selectOffset(block: ElementNode, offset: number): void {
	for (const child of block.getChildren()) {
		const size = child.getTextContentSize();
		if ($isTextNode(child) && offset <= size) {
			child.select(offset, offset);
			return;
		}
		if (offset < size) {
			child.selectPrevious();
			return;
		}
		offset -= size;
	}
	block.selectEnd();
}

/** テキスト位置または要素内の子ノード位置を文字数へ換算する。 */
function $offsetWithinNode(
	point: PointType,
	target: ReturnType<PointType["getNode"]>,
) {
	if (point.type === "text") {
		return point.offset;
	}
	if ($isElementNode(target)) {
		return target
			.getChildren()
			.slice(0, point.offset)
			.reduce((sum, child) => sum + child.getTextContentSize(), 0);
	}
	return 0;
}
