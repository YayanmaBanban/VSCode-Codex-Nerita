<!-- 入力欄の選択位置を保ったまま、コンテキストを追加するメニューを開く。 -->
<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import Tooltip from "../../ui/Tooltip.svelte";

	let {
		disabled,
		onOpen,
	}: { disabled: boolean; onOpen?: (() => void) | undefined } = $props();
</script>

<Tooltip content="コンテキストを追加">
	{#snippet children({ props })}
		<button
			{...props}
			type="button"
			class="attach-button flex rounded-[5px] border-0 bg-transparent p-[5px] enabled:hover:bg-settings-hover"
			aria-label="コンテキストを追加"
			aria-haspopup="listbox"
			disabled={disabled || !onOpen}
			onmousedown={(event) => event.preventDefault()}
			onclick={onOpen}><Plus size={16} aria-hidden="true" /></button
		>
	{/snippet}
</Tooltip>
