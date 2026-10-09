// 下書き同期と入力制限を編集履歴から分離し、再描画でカーソルをリセットしない。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { ComposerPart } from "@nerita/shared/composerContent";
import {
	$getRoot,
	CLEAR_HISTORY_COMMAND,
	HISTORIC_TAG,
	type LexicalEditor,
	SKIP_DOM_SELECTION_TAG,
} from "lexical";
import { useLayoutEffect, type RefObject, useEffect, useRef } from "react";
import { registerComposerCommands } from "./commands";
import { $readParts, $writeParts, contentKey } from "./content";

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
	// ローカル編集の反映が遅れて届いても、それを外部復元として新しい編集へ書き戻さない。
	const localParts = useRef(new WeakSet<ComposerPart[]>());
	useLayoutEffect(() => {
		latest.current = props;
	}, [props]);
	useEffect(() => {
		editor.setEditable(!(props.locked === true));
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
	useEffect(() => registerDraftUpdates(editor, latest, localParts), [editor]);
	useEffect(() => {
		if (
			localParts.current.has(props.parts) ||
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
				if (focused === true) {
					$getRoot().selectEnd();
				}
			},
			{
				tag: [
					"draft-restore",
					HISTORIC_TAG,
					...(focused === true ? [] : [SKIP_DOM_SELECTION_TAG]),
				],
			},
		);
		// 送信済みの文面を取り消し操作で復元させないよう、外部置換時は履歴を分ける。
		editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
	}, [editor, props.parts]);
	return null;
}

/** 編集制限を検証して下書きの変更を通知する。 */
function registerDraftUpdates(
	editor: LexicalEditor,
	latest: RefObject<{
		locked?: boolean;
		parts: ComposerPart[];
		onChange: (parts: ComposerPart[]) => void;
		onSubmit: () => void;
		onError: (message: string) => void;
	}>,
	localParts: RefObject<WeakSet<ComposerPart[]>>,
): () => void {
	return editor.registerUpdateListener(
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
				(!isNonZeroNumber(dirtyElements.size) &&
					!isNonZeroNumber(dirtyLeaves.size))
			) {
				return;
			}
			const parts = editorState.read($readParts);
			if (
				parts.reduce((sum, part) => sum + part.text.length, 0) >
					100000 ||
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
			if (contentKey(parts) !== contentKey(latest.current.parts)) {
				localParts.current.add(parts);
				latest.current.onChange(parts);
			}
		},
	);
}
