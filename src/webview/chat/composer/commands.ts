// 貼り付け・改行・送信をLexicalの更新単位で処理し、履歴と選択範囲を保つ。
import {
	$addUpdateTag,
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
import { PastedBlockNode } from "./PastedBlockNode";
import { $readParts } from "./content";
import { $moveAcrossBlock } from "./navigation";
import { $insertPastedBlock } from "./insertPastedBlock";
import {
	$pasteReferences,
	registerReferenceClipboard,
} from "./referenceClipboard";

/** 代表的なコード構文、または5行以上の本文を貼り付けブロックとして扱う。 */
function shouldPasteAsBlock(text: string): boolean {
	// 末尾の改行は行数に含めない。判定用に整形しても貼り付ける本文は保持する。
	if (text.trimEnd().split("\n").length >= 5) {
		return true;
	}
	// 正規表現では言語を確定できないため、単なる記号や単語では判定しない。
	return [
		/^\s*```[^\n]*\n[\s\S]*\n\s*```\s*$/,
		/^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=\n]+)?=/m,
		/^\s*(?:export\s+)?(?:async\s+)?(?:function|def|fn)\s+[\w$]+\s*\(/m,
		/^\s*(?:import\s+.+\s+from\s+["']|from\s+[\w.]+\s+import\s+)/m,
		/^\s*(?:if|for|while)\s*\([^\n]*\)\s*\{/m,
		/^\s*[\w$]+(?:\.[\w$]+)*\([^\n]*\);?\s*$/m,
		/^\s*<([A-Za-z][\w:-]*)\b[^>]*>[\s\S]*<\/\1>\s*$/,
		/^\s*\{\s*"[^"\n]+"\s*:[\s\S]*\}\s*$/,
	].some((pattern) => pattern.test(text));
}

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
	if (inBlock || editor.isComposing() || !shouldPasteAsBlock(text)) {
		selection.insertRawText(text);
		return true;
	}
	if (parts.length >= 201) {
		onError("貼り付けブロックは100個までです。");
		return true;
	}
	$insertPastedBlock(text);
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
					!event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					event.metaKey
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
