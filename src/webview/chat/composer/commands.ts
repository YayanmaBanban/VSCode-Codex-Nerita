// 貼り付け・改行・送信をLexicalの更新単位で処理し、履歴と選択範囲を保つ。
import {
	$addUpdateTag,
	$createParagraphNode,
	$generateNodesFromRawText,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	HISTORY_PUSH_TAG,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	PASTE_COMMAND,
	mergeRegister,
	type LexicalEditor,
} from "lexical";
import { $createPastedBlockNode, PastedBlockNode } from "./PastedBlockNode";
import { $pointOffset, $readParts } from "./content";
import { $moveAcrossBlock } from "./navigation";
import { $appendInlineContent, $readReferences } from "./inlineReferences";
import {
	$pasteReferences,
	registerReferenceClipboard,
} from "./referenceClipboard";

/** 選択を置換して前後の通常文を保ち、貼り付けを一度でUndoできるようにする。 */
function $paste(
	editor: LexicalEditor,
	event: ClipboardEvent,
	onError: (message: string) => void,
): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !event.clipboardData) {
		return false;
	}
	const text = event.clipboardData
		.getData("text/plain")
		.replace(/\r\n?/g, "\n");
	event.preventDefault();
	const parts = $readParts();
	const total = parts.reduce((sum, part) => sum + part.text.length, 0);
	if (total - selection.getTextContent().length + text.length > 100_000) {
		onError(
			"下書き全体は100,000文字までです。貼り付け内容を短くしてください。",
		);
		return true;
	}
	$addUpdateTag(HISTORY_PUSH_TAG);
	const inBlock =
		selection.anchor.getNode().getTopLevelElement() instanceof
		PastedBlockNode;
	if (
		!inBlock &&
		!editor.isComposing() &&
		$pasteReferences(event.clipboardData, text)
	) {
		return true;
	}
	if (text.length < 1_000 || inBlock || editor.isComposing()) {
		selection.insertRawText(text);
		return true;
	}
	if (parts.length >= 201) {
		onError("貼り付けブロックは100個までです。");
		return true;
	}
	selection.removeText();
	const active = $getSelection();
	if (!$isRangeSelection(active)) {
		return true;
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
	return true;
}

/** 既存の通常入力・IMEを残し、Composer固有の操作だけを優先処理する。 */
export function registerComposerCommands(
	editor: LexicalEditor,
	submit: () => void,
	onError: (message: string) => void,
): () => void {
	return mergeRegister(
		registerReferenceClipboard(editor),
		editor.registerCommand(
			PASTE_COMMAND,
			(event) =>
				event instanceof ClipboardEvent
					? $paste(editor, event, onError)
					: false,
			COMMAND_PRIORITY_HIGH,
		),
		editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (!event) {
					return false;
				}
				if (
					event.isComposing ||
					event.keyCode === 229 ||
					editor.isComposing()
				) {
					return true;
				}
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) {
					return false;
				}
				event.preventDefault();
				if (
					event.shiftKey ||
					selection.anchor.getNode().getTopLevelElement() instanceof
						PastedBlockNode
				) {
					selection.insertLineBreak();
				} else {
					submit();
				}
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		),
		editor.registerCommand(
			KEY_ARROW_UP_COMMAND,
			(event) => $moveAcrossBlock(editor, event, true),
			COMMAND_PRIORITY_HIGH,
		),
		editor.registerCommand(
			KEY_ARROW_DOWN_COMMAND,
			(event) => $moveAcrossBlock(editor, event, false),
			COMMAND_PRIORITY_HIGH,
		),
	);
}
