<!-- 出力プレビューと詳細取得の開閉を表示し、閉じると範囲本文を解放する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { Dialog } from "bits-ui";
	import type { ToolOutputPreview } from "@nerita/shared/toolOutput";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import X from "@lucide/svelte/icons/x";
	import { useToolOutputBridge } from "./ToolExpansion.svelte";
	import CommandOutput from "./CommandOutput.svelte";
	import OutputRange from "./OutputRange.svelte";

	let { output }: { output: ToolOutputPreview } = $props();
	const getBridge = useToolOutputBridge();
	const rangeId = $props.id();
	let expanded = $state(false);
	const bridge = $derived(getBridge?.());
	const canExpand = $derived(
		output.truncated &&
			isNonEmptyString(output.outputRef) &&
			bridge !== undefined,
	);
</script>

<section>
	<CommandOutput text={output.preview} />
	{#if output.truncated}
		{#if canExpand && bridge && isNonEmptyString(output.outputRef)}
			<Dialog.Root bind:open={expanded}>
				<Dialog.Trigger
					class={cn(
						"mt-[8px] inline-flex items-center gap-[6px] rounded-[5px] border-0 bg-transparent px-[6px] py-[4px]",
						"text-[12px] text-muted",
						"hover:bg-settings-hover",
						"focus-visible:outline-1 focus-visible:outline-settings-focus",
					)}
				>
					詳細出力 <ChevronRight size={14} aria-hidden="true" />
				</Dialog.Trigger>
				<Dialog.Portal>
					<Dialog.Overlay class="fixed inset-0 z-40 bg-black/30" />
					<Dialog.Content
						class={cn(
							"fixed inset-y-[12px] right-[12px] z-50 flex w-[min(720px,calc(100vw-24px))] flex-col rounded-[8px]",
							"border border-solid border-menu-border bg-menu p-[12px] text-menu-text shadow-[0_6px_24px_#0003] outline-none",
						)}
					>
						<div
							class="mb-[8px] flex shrink-0 items-center justify-between gap-[8px]"
						>
							<Dialog.Title class="m-0 text-[14px] font-medium"
								>詳細出力</Dialog.Title
							>
							<Dialog.Close
								aria-label="詳細出力を閉じる"
								class={cn(
									"inline-flex size-[28px] items-center justify-center rounded-[5px] border-0 bg-transparent p-0",
									"hover:bg-settings-hover focus-visible:outline-1 focus-visible:outline-settings-focus",
								)}
							>
								<X size={16} aria-hidden="true" />
							</Dialog.Close>
						</div>
						<Dialog.Description class="sr-only"
							>コマンドの出力を範囲ごとに確認できます。</Dialog.Description
						>
						{#if expanded}
							{#key output.outputRef}
								<OutputRange
									id={rangeId}
									outputRef={output.outputRef}
									{bridge}
								/>
							{/key}
						{/if}
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		{:else}
			<p class="text-[12px] text-muted">
				省略部分の出力を取得できません。
			</p>
		{/if}
	{/if}
</section>
