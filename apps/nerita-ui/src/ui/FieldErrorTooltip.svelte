<!-- 入力欄と関連付けたエラーを、入力欄の下の吹き出しで表示する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import SquareExclamationPoint from "@lucide/svelte/icons/square-exclamation-point";
	import { cn } from "cnfast";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	let {
		message,
		children,
	}: {
		message?: string | undefined;
		children: Snippet<
			[
				{
					props: {
						"aria-invalid"?: true;
						"aria-errormessage"?: string;
						"aria-describedby"?: string;
					};
				},
			]
		>;
	} = $props();
	const id = $props.id();
	let hasError = $derived(isNonEmptyString(message));
	let inputProps = $derived(
		hasError
			? {
					"aria-invalid": true as const,
					"aria-errormessage": id,
					"aria-describedby": id,
				}
			: {},
	);
</script>

<div class="grid min-w-0 gap-2">
	{@render children({ props: inputProps })}
	{#if hasError}
		<div
			{id}
			role="alert"
			class={cn(
				"relative flex min-w-0 items-start gap-2 rounded-md border border-tooltip-border bg-tooltip px-3 py-2 text-xs leading-relaxed text-tooltip-text",
				"[overflow-wrap:anywhere]",
			)}
		>
			<span
				aria-hidden="true"
				class="absolute -top-[5px] left-4 size-2 rotate-45 border-t border-l border-tooltip-border bg-tooltip"
			></span>
			<SquareExclamationPoint
				size={16}
				aria-hidden="true"
				class="relative shrink-0 text-warning"
			/>
			<span class="relative min-w-0">{message}</span>
		</div>
	{/if}
</div>
