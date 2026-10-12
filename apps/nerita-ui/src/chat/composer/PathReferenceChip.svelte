<script lang="ts">
	import { onMount, untrack } from "svelte";
	import X from "@lucide/svelte/icons/x";
	import { cn } from "cnfast";
	import { pathText } from "@nerita/shared/composerReferences";
	import {
		$getNodeByKey as getNodeByKey,
		HISTORY_PUSH_TAG,
		type LexicalEditor,
		type NodeKey,
	} from "lexical";
	import type { ComposerTarget } from "@nerita/shared/composerTargets";
	import {
		referenceKindLabel,
		referenceActionLabel,
	} from "./referencePresentation";
	import { OPEN_REFERENCE_COMMAND } from "./ReferenceActionsPlugin.svelte";
	import ReferenceChipContent from "../ReferenceChipContent.svelte";
	let {
		nodeKey,
		path,
		editor,
	}: { nodeKey: NodeKey; path: ComposerTarget; editor: LexicalEditor } =
		$props();
	let editable = $state(untrack(() => editor.isEditable()));
	onMount(() =>
		editor.registerEditableListener((value) => {
			editable = value;
		}),
	);
	function open(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		editor.dispatchCommand(OPEN_REFERENCE_COMMAND, path);
	}
	function remove(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		editor.update(
			() => {
				const node = getNodeByKey(nodeKey);
				if (node?.isAttached() === true) {
					node.selectPrevious();
					node.remove();
				}
			},
			{ tag: HISTORY_PUSH_TAG, discrete: true },
		);
		editor.getRootElement()?.focus({ preventScroll: true });
		editor.focus();
	}
	const stopKey = (event: KeyboardEvent) => event.stopPropagation();
	const keepSelection = (event: MouseEvent) => event.preventDefault();
</script>

<span
	title={pathText(path)}
	aria-label={`${referenceKindLabel(path)}: ${pathText(path)}`}
	class={cn(
		"inline-flex max-w-full items-center rounded-[5px] border border-solid border-panel-border bg-input align-middle text-[12px] leading-normal [&_svg]:shrink-0",
	)}
>
	<button
		type="button"
		disabled={!editable}
		aria-label={referenceActionLabel(path)}
		class="inline-flex min-w-0 items-center gap-[5px] border-0 bg-transparent px-[5px] py-[4px] hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus"
		onmousedown={keepSelection}
		onkeydown={stopKey}
		onkeyup={stopKey}
		onclick={open}><ReferenceChipContent {path} /></button
	>
	<button
		type="button"
		disabled={!editable}
		aria-label={`${path.name} の参照を取り外す`}
		class="inline-flex shrink-0 items-center border-0 bg-transparent px-[5px] py-[4px] hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus"
		onmousedown={keepSelection}
		onkeydown={stopKey}
		onkeyup={stopKey}
		onclick={remove}><X size={12} aria-hidden="true" /></button
	>
</span>
