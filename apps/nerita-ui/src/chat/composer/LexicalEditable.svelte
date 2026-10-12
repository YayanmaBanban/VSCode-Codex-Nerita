<script lang="ts">
	import { onMount } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { getLexicalEditor } from "./lexicalContext";
	let {
		disabled = false,
		element = $bindable(),
		...attributes
	}: HTMLAttributes<HTMLDivElement> & {
		disabled?: boolean;
		element?: HTMLDivElement | undefined;
	} = $props();
	const editor = getLexicalEditor();
	// disabled の変化を外部エディターへ反映し、Lexical 自身の編集制御も切り替える。
	$effect(() => editor.setEditable(!disabled));
	onMount(() => {
		editor.setRootElement(element ?? null);
		return () => editor.setRootElement(null);
	});
</script>

<div
	{...attributes}
	bind:this={element}
	contenteditable={!disabled}
	role="textbox"
	aria-multiline="true"
></div>
