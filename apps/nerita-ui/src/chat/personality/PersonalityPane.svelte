<!-- グローバルとワークスペースの性格設定を、範囲ごとの開閉可能な編集欄にまとめる。 -->
<script lang="ts">
	import type {
		PersonalityMessage,
		PersonalityScope,
	} from "@nerita/shared/personality";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import { cn } from "cnfast";
	import PersonalityPaneEditor from "./PersonalityPaneEditor.svelte";

	let {
		scope,
		settings,
		pending,
		send,
	}: {
		scope: "global" | "workspace";
		settings: PersonalityScope;
		pending: boolean;
		send: (message: PersonalityMessage) => void;
	} = $props();
	let title = $derived(scope === "global" ? "グローバル" : "ワークスペース");
	let expanded = $state(true);
</script>

<section
	aria-label={title}
	class="border-0 border-t border-solid border-message-border py-[12px]"
>
	<button
		type="button"
		aria-expanded={expanded}
		aria-controls={`personality-${scope}`}
		onclick={() => {
			expanded = !expanded;
		}}
		class="flex w-full items-center justify-between border-0 bg-transparent px-0 py-[4px] text-inherit"
		><span>{title}</span>{#if expanded}<ChevronUp
				size={16}
			/>{:else}<ChevronDown size={16} />{/if}</button
	>
	<div
		id={`personality-${scope}`}
		inert={!expanded}
		aria-hidden={!expanded}
		class={cn(
			"grid transition-[grid-template-rows] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
			expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
		)}
	>
		<div class="min-h-0 overflow-hidden">
			{#key JSON.stringify(settings)}<PersonalityPaneEditor
					{scope}
					{settings}
					{pending}
					{send}
					{title}
				/>{/key}
		</div>
	</div>
</section>
