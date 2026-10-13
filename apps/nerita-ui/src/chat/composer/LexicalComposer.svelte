<!-- Lexical のエディター・履歴・参照チップを生成し、子の入力部品へ共有して破棄時に解放する。 -->
<script lang="ts">
	import { SvelteMap } from "svelte/reactivity";
	import {
		getAllContexts,
		onMount,
		mount,
		unmount,
		untrack,
		type Snippet,
	} from "svelte";
	import {
		createEditor,
		CLEAR_HISTORY_COMMAND,
		mergeRegister,
		type CreateEditorArgs,
		type NodeKey,
	} from "lexical";
	import { registerPlainText } from "@lexical/plain-text";
	import { createEmptyHistoryState, registerHistory } from "@lexical/history";
	import { setLexicalEditor, setLexicalHistoryReset } from "./lexicalContext";
	import type { PathReferenceDecoration } from "./PathReferenceNode";
	import PathReferenceChip from "./PathReferenceChip.svelte";

	let {
		config,
		initialize,
		children,
	}: {
		config: CreateEditorArgs;
		initialize: () => void;
		children: Snippet;
	} = $props();
	// 設定と初期本文は生成時だけ使い、外部の下書き復元は専用プラグインが扱う。
	const editor = untrack(() => createEditor(config));
	setLexicalEditor(editor);
	const context = getAllContexts();
	editor.update(() => initialize(), { discrete: true });
	const history = createEmptyHistoryState();
	/** 外部から本文を復元した後の状態を履歴の基準にし、前の会話の編集履歴を持ち越さない。 */
	function resetHistory() {
		editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
		history.current = { editor, editorState: editor.getEditorState() };
	}
	resetHistory();
	setLexicalHistoryReset(resetHistory);

	onMount(() => {
		const decorations = new SvelteMap<
			NodeKey,
			{ target: HTMLElement; instance: ReturnType<typeof mount> }
		>();
		let disposed = false;
		/** Lexical の描画ノードに参照チップを取り付け、不要になった表示部品を解放する。 */
		const renderDecorations = () => {
			if (disposed) {
				return;
			}
			const current = editor.getDecorators<PathReferenceDecoration>();
			for (const [key, mounted] of decorations) {
				const removed =
					!current[key] ||
					editor.getElementByKey(key) !== mounted.target;
				if (removed) {
					void unmount(mounted.instance);
					decorations.delete(key);
				}
			}
			for (const [key, decoration] of Object.entries(current)) {
				const target = editor.getElementByKey(key);
				if (!target || decorations.has(key)) {
					continue;
				}
				const instance = mount(PathReferenceChip, {
					target,
					context,
					props: { ...decoration, editor },
				});
				decorations.set(key, { target, instance });
			}
		};
		const cleanup = mergeRegister(
			registerPlainText(editor),
			registerHistory(editor, history, 300),
			editor.registerDecoratorListener(() =>
				queueMicrotask(renderDecorations),
			),
			editor.registerRootListener(() =>
				queueMicrotask(renderDecorations),
			),
		);
		renderDecorations();
		return () => {
			disposed = true;
			cleanup();
			for (const mounted of decorations.values()) {
				void unmount(mounted.instance);
			}
			decorations.clear();
			editor.setRootElement(null);
		};
	});
</script>

{@render children()}
