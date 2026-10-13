<script lang="ts">
	// 認証先の設定状態と開閉操作を表示し、閉じた内容への操作を無効にする。

	import { cn } from "cnfast";

	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";

	import "../chat/chat.css";

	import { type AuthProviderItemProps } from "./PiAuthEditorParts";
	import AuthProviderContent from "./AuthProviderContent.svelte";

	let props: AuthProviderItemProps = $props();
	let { item, open, setExpanded } = $derived(props);
</script>

<li class="border-0 border-b border-solid border-message-border">
	<button
		type="button"
		aria-expanded={open}
		aria-controls={`provider-${item.id}`}
		onclick={() => setExpanded(open ? null : item.id)}
		class={cn(
			"flex w-full items-center gap-[12px] rounded-none border-0 bg-transparent",
			"px-[8px] py-[16px] text-left",
			"hover:bg-settings-hover",
		)}
		>{#if open}
			<ChevronDown size={18} aria-hidden="true" />
		{:else}
			<ChevronRight size={18} aria-hidden="true" />
		{/if}<span class="min-w-0 flex-1 font-medium break-words"
			>{item.name}</span
		>{#if item.configured}
			<Check
				size={18}
				class="shrink-0 text-menu-check"
				aria-label="設定済み"
			/>
		{/if}</button
	>
	<div
		id={`provider-${item.id}`}
		inert={!open}
		aria-hidden={!open}
		class={cn(
			"grid transition-[grid-template-rows] duration-200 ease-out",
			"motion-reduce:transition-none",
			open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
		)}
	>
		<div class="min-h-0 overflow-hidden">
			<AuthProviderContent {...{ ...props }} />
		</div>
	</div>
</li>
