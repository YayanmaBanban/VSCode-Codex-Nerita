<script lang="ts">
	// 未保存の文書を枠で示し、動きを減らす設定では静止させる。
	import { cn } from "cnfast";
	import { MediaQuery } from "svelte/reactivity";
	import SettingsTooltip from "../../chat/SettingsTooltip.svelte";
	import BorderBeam from "../../ui/BorderBeam.svelte";
	import { buttonStyle } from "./fields";
	let {
		dirty,
		busy,
		onSave,
	}: { dirty: boolean; busy: boolean; onSave: () => void } = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
</script>

<SettingsTooltip content={dirty ? "未保存の変更があります" : "設定を保存"}>
	{#snippet children({ props })}
		<button
			{...props}
			class={cn(buttonStyle, "relative overflow-hidden")}
			aria-label="保存"
			disabled={busy}
			onclick={onSave}
		>
			保存
			{#if dirty}<span aria-hidden="true" data-testid="unsaved-beam"
					><BorderBeam
						size={32}
						duration={4}
						borderThickness={2}
						transition={reducedMotion.current
							? { duration: 0, repeat: 0 }
							: {}}
					/></span
				>{/if}
		</button>
	{/snippet}
</SettingsTooltip>
