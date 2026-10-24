<!-- Worktree の削除要求を、共通の長押しボタンとツールチップへ接続する。 -->
<script lang="ts">
	import Tooltip from "../../ui/Tooltip.svelte";
	import HoldToDeleteButton from "../../ui/HoldToDeleteButton.svelte";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";

	let {
		name,
		disabled,
		pending = false,
		onDelete,
	}: {
		name: string;
		disabled: boolean;
		pending?: boolean;
		onDelete: () => void;
	} = $props();
	let holding = $state(false);
</script>

{#if pending}
	<span
		role="status"
		class="flex shrink-0 items-center gap-1 text-[12px] text-muted"
	>
		<LoaderCircle
			size={16}
			class="motion-safe:animate-spin"
			aria-hidden="true"
		/>削除中
	</span>
{:else}
	<Tooltip content="ワークツリーの削除" disabled={holding}>
		{#snippet children({ props })}
			<HoldToDeleteButton
				label={`${name}を削除`}
				{disabled}
				{onDelete}
				bind:holding
				triggerProps={props}
			/>
		{/snippet}
	</Tooltip>
{/if}
