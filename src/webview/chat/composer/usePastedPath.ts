// #直後のパス・コピーしたコードを Host で照合し、編集位置が変わっていない場合だけ参照にする。
import { useEffect } from "react";
import {
	$addUpdateTag,
	$getNodeByKey,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	HISTORY_PUSH_TAG,
	PASTE_COMMAND,
	type LexicalEditor,
} from "lexical";
import type { Bridge } from "../../vscodeBridge";
import { parsePastedPath } from "../../../shared/pastedPath";
import { $completion, $insertCompletion, type Completion } from "./completions";
import { $pointOffset, $readParts } from "./content";

/** 非同期応答は元に戻す操作・削除・カーソル移動後の本文を上書きしない。 */
export function usePastedPath(
	editor: LexicalEditor,
	bridge: Bridge | undefined,
) {
	useEffect(() => {
		if (!bridge) {
			return;
		}
		let cancel = () => {};
		const unregister = editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (
					!(event instanceof ClipboardEvent) ||
					editor.isComposing()
				) {
					return false;
				}
				const match = $completion();
				const selection = $getSelection();
				const text = pastedPlainText(event);
				const target = parsePastedPath(text);
				if (
					match?.marker !== "#" ||
					match.query !== "" ||
					!$isRangeSelection(selection) ||
					!text.trim()
				) {
					return false;
				}
				if (
					$readParts().reduce(
						(sum, part) => sum + part.text.length,
						0,
					) +
						text.length >
					100_000
				) {
					return false;
				}

				cancel();
				event.preventDefault();
				$addUpdateTag(HISTORY_PUSH_TAG);
				selection.insertRawText(text);
				const pasted = { ...match, end: match.end + text.length };
				const expected = completionBlockText(match);
				const requestId = crypto.randomUUID();
				const unsubscribe = bridge.subscribe((message) => {
					if (
						message.type !== "workspace/resolvedPath" ||
						message.requestId !== requestId
					) {
						return;
					}
					cancel();
					const reference = message.entry;
					if (!reference) {
						return;
					}
					editor.update(() => {
						const block = $getNodeByKey(match.key);
						const current = $getSelection();
						if (
							!$isElementNode(block) ||
							block.getTextContent() !== expected ||
							!$isRangeSelection(current) ||
							!current.isCollapsed() ||
							current.anchor
								.getNode()
								.getTopLevelElement()
								?.getKey() !== match.key ||
							$pointOffset(current.anchor, block) !== pasted.end
						) {
							return;
						}
						$insertCompletion(pasted, "", reference);
					});
				});
				const timer = setTimeout(() => cancel(), 10_000);
				cancel = () => {
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
			},
			COMMAND_PRIORITY_CRITICAL,
		);
		return () => {
			cancel();
			unregister();
		};
	}, [editor, bridge]);
}

/** 非同期照合に使用する補完対象ブロックの本文を保存する。 */
function completionBlockText(match: Completion) {
	return $getNodeByKey(match.key)?.getTextContent();
}

/** 改行を正規化した貼り付け本文を取り出す。 */
function pastedPlainText(event: ClipboardEvent) {
	return (event.clipboardData?.getData("text/plain") ?? "").replace(
		/\r\n?/g,
		"\n",
	);
}
