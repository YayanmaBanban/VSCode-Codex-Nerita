// 通常のコピー内容に参照情報を添え、同じ入力欄では検証後にチップへ戻す。
import {
	$createParagraphNode,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	COPY_COMMAND,
	CUT_COMMAND,
	mergeRegister,
	type LexicalEditor,
} from "lexical";
import {
	validReferences,
	type ComposerReference,
} from "../../../shared/composerReferences";
import { PathReferenceNode } from "./PathReferenceNode";
import { $appendInlineContent } from "./inlineReferences";

export const referenceClipboardType =
	"application/x-codex-composer-references+json";

/** 選択範囲に完全に含まれる参照の位置を、コピー本文に合わせて収集する。 */
function $copyReferences(event: ClipboardEvent): void {
	const selection = $getSelection();
	if (
		!$isRangeSelection(selection) ||
		selection.isCollapsed() ||
		!event.clipboardData
	) {
		return;
	}
	const references: ComposerReference[] = [];
	for (const node of selection.getNodes()) {
		if (!(node instanceof PathReferenceNode)) {
			continue;
		}
		const prefix = selection.clone();
		const start = selection.isBackward()
			? selection.focus
			: selection.anchor;
		prefix.anchor.set(start.key, start.offset, start.type);
		// 要素境界では直前のチップまで含めて数え、その長さを引いて開始位置を得る。
		prefix.focus.set(
			node.getParentOrThrow().getKey(),
			node.getIndexWithinParent() + 1,
			"element",
		);
		references.push({
			offset: prefix.getTextContent().length - node.getTextContentSize(),
			path: node.getPath(),
		});
	}
	const text = selection.getTextContent();
	if (
		references.length &&
		text.length <= 100_000 &&
		validReferences(text, references)
	) {
		event.clipboardData.setData(
			referenceClipboardType,
			JSON.stringify({ version: 1, text, references }),
		);
	}
}

/** 外部アプリの壊れた・古い付加情報は捨て、通常の文字列貼り付けへ戻す。 */
export function readClipboardReferences(
	data: Pick<DataTransfer, "getData">,
	text: string,
): ComposerReference[] | null {
	const raw = data.getData(referenceClipboardType);
	if (!raw || raw.length > 4_000_000 || text.length > 100_000) {
		return null;
	}
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object") {
			return null;
		}
		const payload = value as Record<string, unknown>;
		if (
			payload.version !== 1 ||
			payload.text !== text ||
			!Array.isArray(payload.references) ||
			!payload.references.length ||
			!validReferences(text, payload.references)
		) {
			return null;
		}
		return payload.references as ComposerReference[];
	} catch {
		return null;
	}
}

/** 既存の文字数検査・Undo境界の内側で、選択範囲をチップ付きの本文へ置換する。 */
export function $pasteReferences(data: DataTransfer, text: string): boolean {
	const references = readClipboardReferences(data, text);
	const selection = $getSelection();
	if (!references || !$isRangeSelection(selection)) {
		return false;
	}
	const container = $createParagraphNode();
	$appendInlineContent(container, text, references);
	selection.insertNodes(container.getChildren());
	return true;
}

/** 本文・HTMLのコピーとカットの削除は標準処理へ渡し、付加情報だけを書く。 */
export function registerReferenceClipboard(editor: LexicalEditor): () => void {
	const copy = (event: ClipboardEvent | KeyboardEvent | null) => {
		if (event instanceof ClipboardEvent) {
			$copyReferences(event);
		}
		return false;
	};
	return mergeRegister(
		editor.registerCommand(COPY_COMMAND, copy, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(CUT_COMMAND, copy, COMMAND_PRIORITY_HIGH),
	);
}
