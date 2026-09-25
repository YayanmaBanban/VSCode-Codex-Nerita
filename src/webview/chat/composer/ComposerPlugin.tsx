// 下書き同期と入力制限を編集履歴から分離し、再描画でカーソルをリセットしない。
import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$getRoot,
	CLEAR_HISTORY_COMMAND,
	HISTORIC_TAG,
	SKIP_DOM_SELECTION_TAG,
} from "lexical";
import type { ComposerPart } from "../../../shared/composerContent";
import { contentKey, $readParts, $writeParts } from "./content";
import { registerComposerCommands } from "./commands";

/** 保存・復元・文字数検証とキー操作を1つのエディタへ接続する。 */
export function ComposerPlugin(props: {
	locked?: boolean;
	parts: ComposerPart[];
	onChange: (parts: ComposerPart[]) => void;
	onSubmit: () => void;
	onError: (message: string) => void;
}) {
	const [editor] = useLexicalComposerContext();
	const latest = useRef(props);
	latest.current = props;
	useEffect(() => {
		editor.setEditable(!props.locked);
	}, [editor, props.locked]);
	useEffect(
		() =>
			registerComposerCommands(
				editor,
				() => latest.current.onSubmit(),
				(message) => latest.current.onError(message),
			),
		[editor],
	);
	useEffect(
		() =>
			editor.registerUpdateListener(
				({
					editorState,
					prevEditorState,
					dirtyElements,
					dirtyLeaves,
					tags,
				}) => {
					if (
						tags.has("draft-restore") ||
						tags.has("draft-reject") ||
						(!dirtyElements.size && !dirtyLeaves.size)
					) {
						return;
					}
					const parts = editorState.read($readParts);
					if (
						parts.reduce((sum, part) => sum + part.text.length, 0) >
							100_000 ||
						parts.length > 201
					) {
						const previous = prevEditorState.read($readParts);
						editor.update(
							() => {
								$writeParts(previous);
								$getRoot().selectEnd();
							},
							{ tag: "draft-reject" },
						);
						latest.current.onError(
							"下書き全体は100,000文字、貼り付けブロックは100個までです。",
						);
						return;
					}
					latest.current.onError("");
					if (
						contentKey(parts) !== contentKey(latest.current.parts)
					) {
						latest.current.onChange(parts);
					}
				},
			),
		[editor],
	);
	useEffect(() => {
		if (
			editor.getEditorState().read(() => contentKey($readParts())) ===
			contentKey(props.parts)
		) {
			return;
		}
		const focused = editor
			.getRootElement()
			?.contains(document.activeElement);
		editor.update(
			() => {
				$writeParts(props.parts);
				if (focused) {
					$getRoot().selectEnd();
				}
			},
			{
				tag: [
					"draft-restore",
					HISTORIC_TAG,
					...(focused ? [] : [SKIP_DOM_SELECTION_TAG]),
				],
			},
		);
		// 送信済みの文面を取り消し操作で復元させないよう、外部置換時は履歴を分ける。
		editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
	}, [editor, props.parts]);
	return null;
}
