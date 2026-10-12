<!-- Markdown の表示文字にある検証済み参照識別子だけをチップへ戻す。 -->
<script lang="ts">
	import type { ComposerTarget } from "@nerita/shared/composerTargets";
	import type { UiMessage } from "@nerita/shared/messages";
	import MessageReferenceChip from "./MessageReferenceChip.svelte";
	let {
		value,
		targets,
		send,
	}: {
		value: string;
		targets: ReadonlyMap<string, ComposerTarget>;
		send?: ((message: UiMessage) => void) | undefined;
	} = $props();
	const segments = $derived.by(() => {
		const tokens = [...targets.keys()];
		return tokens.length === 0
			? [value]
			: value.split(new RegExp(`(${tokens.join("|")})`, "g"));
	});
</script>

{#each segments as segment, index (index)}
	{@const target = targets.get(segment)}
	{#if target}<MessageReferenceChip
			path={target}
			{send}
		/>{:else}{segment}{/if}
{/each}
