<script lang="ts">
	import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
	import type { ComposerPart } from "@nerita/shared/composerContent";
	import {
		$getRoot as getRoot,
		HISTORIC_TAG,
		type LexicalEditor,
		SKIP_DOM_SELECTION_TAG,
	} from "lexical";
	import { getLexicalEditor, getLexicalHistoryReset } from "./lexicalContext";
	import { registerComposerCommands } from "./commands";
	import {
		$readParts as readParts,
		$writeParts as writeParts,
		contentKey,
	} from "./content";
	type Reference<T> = { current: T };
	type ComposerPluginProps = {
		locked?: boolean | undefined;
		parts: ComposerPart[];
		onChange: (parts: ComposerPart[]) => void;
		onSubmit: () => void;
		onError: (message: string) => void;
	};
	let { locked, parts, onChange, onSubmit, onError }: ComposerPluginProps =
		$props();
	const pluginProps = {
		get locked() {
			return locked;
		},
		get parts() {
			return parts;
		},
		get onChange() {
			return onChange;
		},
		get onSubmit() {
			return onSubmit;
		},
		get onError() {
			return onError;
		},
	};

	const editor = getLexicalEditor();
	const resetHistory = getLexicalHistoryReset();
	const latest = {
		get current() {
			return pluginProps;
		},
	};
	// ローカル編集の反映が遅れて届いても、それを外部復元として新しい編集へ書き戻さない。
	const localParts = { current: new WeakSet<ComposerPart[]>() };

	// 送信ロックが変わるたびに、Svelte が管理しない Lexical の編集可否を同期する。
	$effect(() => {
		editor.setEditable(!(pluginProps.locked === true));
	});
	// エディターの寿命に送信コマンドを結び付け、プラグイン破棄時に登録を解除する。
	$effect(() =>
		registerComposerCommands(
			editor,
			() => latest.current.onSubmit(),
			(message) => latest.current.onError(message),
		),
	);
	// Lexical の編集通知を下書きへ渡し、破棄後に古い入力欄から変更が届くことを防ぐ。
	$effect(() => registerDraftUpdates(editor, latest, localParts));
	// Host からの復元は外部エディターへの書き込みが必要で、ローカル編集の反響は除外する。
	$effect(() => {
		const matchesHas =
			localParts.current.has(pluginProps.parts) ||
			editor.getEditorState().read(() => contentKey(readParts())) ===
				contentKey(pluginProps.parts);
		if (matchesHas) {
			return;
		}
		const focused = editor
			.getRootElement()
			?.contains(document.activeElement);
		editor.update(
			() => {
				writeParts(pluginProps.parts);
				if (focused === true) {
					getRoot().selectEnd();
				}
			},
			{
				discrete: true,
				tag: [
					"draft-restore",
					HISTORIC_TAG,
					...(focused === true ? [] : [SKIP_DOM_SELECTION_TAG]),
				],
			},
		);
		// 送信済みの文面を取り消し操作で復元させないよう、外部置換時は履歴を分ける。
		resetHistory();
	});

	/** 編集制限を検証して下書きの変更を通知する。 */
	function registerDraftUpdates(
		editor: LexicalEditor,
		latest: Reference<{
			locked?: boolean | undefined;
			parts: ComposerPart[];
			onChange: (parts: ComposerPart[]) => void;
			onSubmit: () => void;
			onError: (message: string) => void;
		}>,
		localParts: Reference<WeakSet<ComposerPart[]>>,
	): () => void {
		/** 復元イベントを除外して下書きの差分を公開し、上限を超える編集は直前の本文へ戻す。 */
		const publishDraftUpdate: Parameters<
			typeof editor.registerUpdateListener
		>[0] = ({
			editorState,
			prevEditorState,
			dirtyElements,
			dirtyLeaves,
			tags,
		}) => {
			if (tags.has("draft-restore") || tags.has("draft-reject")) {
				return;
			}
			const matchesIsNonZeroNumber =
				!isNonZeroNumber(dirtyElements.size) &&
				!isNonZeroNumber(dirtyLeaves.size);
			if (matchesIsNonZeroNumber) {
				return;
			}
			const parts = editorState.read(readParts);
			const matchesReduce =
				parts.reduce((sum, part) => sum + part.text.length, 0) >
					100000 || parts.length > 201;
			if (matchesReduce) {
				const previous = prevEditorState.read(readParts);
				editor.update(
					() => {
						writeParts(previous);
						getRoot().selectEnd();
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
		};
		return editor.registerUpdateListener(publishDraftUpdate);
	}
</script>
