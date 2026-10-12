<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	import { type PiAuthItem } from "@nerita/shared/piAuth";

	import { cn } from "cnfast";

	import "../chat/chat.css";

	let {
		item,
		feedback,
	}: {
		item: PiAuthItem;
		feedback: { notice: string; error: string | null } | undefined;
	} = $props();
</script>

<div
	aria-label={`${item.name}の通知`}
	class="mb-[12px] overflow-y-auto overscroll-contain"
>
	{#if isNonEmptyString(feedback?.error)}
		<p
			role="alert"
			class={cn(
				"m-0 rounded-[6px] border border-alert-border bg-alert p-[12px]",
				"leading-[20px] break-words",
			)}
		>
			{feedback.error}
		</p>
	{/if}{#if isNonEmptyString(feedback?.notice)}
		<p
			role="status"
			class={cn(
				"m-0 gap-[8px] rounded-[6px] border border-tooltip-border bg-tooltip",
				"p-[12px] leading-[20px] break-words",
			)}
		>
			{feedback.notice}
		</p>
	{/if}{#if !isNonEmptyString(feedback?.error) && !isNonEmptyString(feedback?.notice)}
		<p
			role="status"
			class={cn(
				"m-0 h-[40px] rounded-[6px] border border-tooltip-border bg-tooltip",
				"p-[12px] leading-[20px] break-words",
			)}
		></p>
	{/if}
</div>
