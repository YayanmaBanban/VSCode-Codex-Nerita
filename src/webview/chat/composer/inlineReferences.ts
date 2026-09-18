// 通常文のパス参照を位置情報へ変換し、復元や貼り付け時にも保持する。
import { $generateNodesFromRawText, type ElementNode } from "lexical";
import {
	pathText,
	type ComposerReference,
} from "../../../shared/composerReferences";
import {
	PathReferenceNode,
	$createPathReferenceNode,
} from "./PathReferenceNode";

/** 段落内の参照を、送信本文に対する位置で収集する。 */
export function $readReferences(
	block: ElementNode,
	offset = 0,
): ComposerReference[] {
	const references: ComposerReference[] = [];
	for (const child of block.getChildren()) {
		if (child instanceof PathReferenceNode) {
			references.push({ offset, path: child.getPath() });
		}
		offset += child.getTextContentSize();
	}
	return references;
}

/** 通常文の指定区間を、参照チップを維持して要素へ追加する。 */
export function $appendInlineContent(
	block: ElementNode,
	text: string,
	references: ComposerReference[] = [],
	start = 0,
	end = text.length,
): void {
	let cursor = start;
	for (const reference of references) {
		const next = reference.offset + pathText(reference.path).length;
		if (reference.offset < start || next > end) {
			continue;
		}
		block.append(
			...$generateNodesFromRawText(text.slice(cursor, reference.offset)),
			$createPathReferenceNode(reference.path),
		);
		cursor = next;
	}
	block.append(...$generateNodesFromRawText(text.slice(cursor, end)));
}
