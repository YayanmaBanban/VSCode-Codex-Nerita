type EffectSetup = () => void | (() => void);
// `#` 直後のパス・コピーしたコードを Host で照合し、編集位置が変わっていない場合だけ参照にする。

import {
	type PasteCommandType,
	type CommandListener,
	$addUpdateTag as addUpdateTag,
	$getNodeByKey as getNodeByKey,
	$getSelection as getSelection,
	$isElementNode as isElementNode,
	$isRangeSelection as isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	HISTORY_PUSH_TAG,
	PASTE_COMMAND,
	type LexicalEditor,
} from "lexical";

import type { Bridge } from "@nerita/shared/bridge";

import { parsePastedPath } from "@nerita/shared/pastedPath";

import { type WorkspacePath } from "@nerita/shared/workspacePaths";

import {
	$completion as completion,
	$insertCompletion as insertCompletion,
	type Completion,
} from "./completions";

import {
	$pointOffset as pointOffset,
	$readParts as readParts,
} from "./content";
export function usePastedPath(input: {
	editor: LexicalEditor;
	bridge: Bridge | undefined;
}) {
	const editor = $derived(input.editor);
	const bridge = $derived(input.bridge);

	// Bridge が変わると旧パス照合の応答待ちと、エディターの貼り付けコマンドを解除する。
	$effect(() => createPastedPathEffect(bridge, editor)());
}

/** 貼り付けたパスの照合処理を登録し、終了時に照合待ちの購読とコマンド登録を解除する。 */
function createPastedPathEffect(
	bridge: undefined | Bridge,
	editor: LexicalEditor,
): EffectSetup {
	return () => {
		if (!bridge) {
			return;
		}
		const pending = { cancel: () => {} };
		const unregister = editor.registerCommand(
			PASTE_COMMAND,
			createPastedPathHandler(editor, pending, bridge),
			COMMAND_PRIORITY_CRITICAL,
		);
		return () => {
			pending.cancel();
			unregister();
		};
	};
}

/** 照合待ちの購読を置き換え、貼り付け位置が変わらない場合だけ参照へ変換する。 */
function createPastedPathHandler(
	editor: LexicalEditor,
	pending: { cancel: () => void },
	bridge: Bridge,
): CommandListener<PasteCommandType> {
	return (event) => {
		if (!(event instanceof ClipboardEvent) || editor.isComposing()) {
			return false;
		}
		const match = completion();
		const selection = getSelection();
		const text = pastedPlainText(event);
		const target = parsePastedPath(text);

		if (match?.marker !== "#") {
			return false;
		}
		if (match.query !== "") {
			return false;
		}
		if (!isRangeSelection(selection)) {
			return false;
		}
		if (text.trim() === "") {
			return false;
		}
		if (pastedContentTooLarge(text)) {
			return false;
		}

		pending.cancel();
		event.preventDefault();
		addUpdateTag(HISTORY_PUSH_TAG);
		selection.insertRawText(text);
		const pasted = { ...match, end: match.end + text.length };
		const expected = completionBlockText(match);
		const requestId = crypto.randomUUID();
		const unsubscribe = bridge.subscribe((message) => {
			const matchesType =
				message.type !== "workspace/resolvedPath" ||
				message.requestId !== requestId;
			if (matchesType) {
				return;
			}
			pending.cancel();
			const reference = message.entry;
			if (!reference) {
				return;
			}
			insertResolvedPath(editor, match, expected, pasted, reference);
		});
		const timer = setTimeout(() => pending.cancel(), 10000);
		pending.cancel = () => {
			unsubscribe();
			clearTimeout(timer);
		};
		bridge.postMessage(
			target
				? {
						type: "workspace/resolvePath",
						requestId,
						...target,
					}
				: { type: "workspace/resolveCode", requestId, text },
		);
		return true;
	};
}

/** 本文とカーソルが貼り付け位置に残る場合だけ参照へ置換する。 */
function insertResolvedPath(
	editor: LexicalEditor,
	match: Completion,
	expected: undefined | string,
	pasted: Completion,
	reference: WorkspacePath,
) {
	/** 要求時の本文とカーソル位置が維持される場合だけ、解決した参照を挿入する。 */
	const insertCurrentResolvedPath = () => {
		const block = getNodeByKey(match.key);
		const current = getSelection();

		if (!isElementNode(block)) {
			return;
		}
		if (block.getTextContent() !== expected) {
			return;
		}
		if (!isRangeSelection(current)) {
			return;
		}

		if (!current.isCollapsed()) {
			return;
		}
		const anchorMovedToAnotherBlock =
			current.anchor.getNode().getTopLevelElement()?.getKey() !==
			match.key;
		if (anchorMovedToAnotherBlock) {
			return;
		}
		if (pointOffset(current.anchor, block) !== pasted.end) {
			return;
		}
		insertCompletion(pasted, "", reference);
	};
	editor.update(insertCurrentResolvedPath);
}

/** 非同期照合に使用する補完対象ブロックの本文を保存する。 */
function completionBlockText(match: Completion) {
	return getNodeByKey(match.key)?.getTextContent();
}

/** 改行を正規化した貼り付け本文を取り出す。 */
function pastedPlainText(event: ClipboardEvent) {
	return (event.clipboardData?.getData("text/plain") ?? "").replace(
		/\r\n?/g,
		"\n",
	);
}

/** 貼り付け後の本文が入力上限を超える場合は通常の貼り付けへ委ねる。 */
function pastedContentTooLarge(text: string) {
	return (
		readParts().reduce((sum, part) => sum + part.text.length, 0) +
			text.length >
		100000
	);
}
