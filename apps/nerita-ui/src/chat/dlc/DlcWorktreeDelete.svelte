<!-- Worktree の削除要求を、共通の長押しボタンとツールチップへ接続する。 -->
<script lang="ts">
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import HoldToDeleteButton from "../../ui/HoldToDeleteButton.svelte";

	let {
		name,
		disabled,
		onDelete,
	}: { name: string; disabled: boolean; onDelete: () => void } = $props();
	let holding = $state(false);
</script>

<SettingsTooltip content="ワークツリーの削除" disabled={holding}>
	{#snippet children({ props })}
		<HoldToDeleteButton
			label={`${name}を削除`}
			{disabled}
			{onDelete}
			bind:holding
			triggerProps={props}
		/>
	{/snippet}
</SettingsTooltip>
