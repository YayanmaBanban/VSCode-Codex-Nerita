<!-- Lexical の本文が変化したときにテキストを親へ通知し、入力欄の破棄時に購読を解除する。 -->
<script lang="ts">
	import { onMount } from "svelte";
	import { $getRoot as getRoot } from "lexical";
	import { getLexicalEditor } from "../composer/lexicalContext";

	let { onChange }: { onChange: (text: string) => void } = $props();
	const editor = getLexicalEditor();
	/** 選択位置だけの更新を除き、本文に変更がある場合だけ親へテキストを通知する。 */
	const publish: Parameters<typeof editor.registerUpdateListener>[0] = ({
		editorState,
		dirtyElements,
		dirtyLeaves,
	}) => {
		if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
			return;
		}
		editorState.read(() => onChange(getRoot().getTextContent()));
	};
	onMount(() => editor.registerUpdateListener(publish));
</script>
