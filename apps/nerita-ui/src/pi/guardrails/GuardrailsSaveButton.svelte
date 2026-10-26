<!-- 文書の保存と実行への適用を1つのボタンで要求し、処理中は操作を無効にする。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { buttonStyle } from "./fields";

	let {
		dirty,
		busy,
		onSave,
	}: { dirty: boolean; busy: boolean; onSave: () => void } = $props();
</script>

<Tooltip
	content={dirty
		? "未保存の変更を保存して適用します"
		: "設定を保存して実行に適用します"}
>
	{#snippet children({ props })}
		<button
			{...props}
			class={cn(
				buttonStyle,
				"relative overflow-hidden border-focus bg-primary text-primary-text",
			)}
			aria-label="保存して適用"
			disabled={busy}
			onclick={onSave}
		>
			保存して適用
		</button>
	{/snippet}
</Tooltip>
