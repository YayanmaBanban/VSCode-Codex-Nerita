<script lang="ts">
	import { onMount } from "svelte";
	import { $getRoot as getRoot } from "lexical";
	import { getLexicalEditor } from "../composer/lexicalContext";
	let { onChange }: { onChange: (text: string) => void } = $props();
	const editor = getLexicalEditor();
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
