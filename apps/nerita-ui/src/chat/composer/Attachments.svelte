<!-- 添付ファイルを一覧表示し、ファイルを開く操作と入力から取り外す操作を親へ伝える。 -->
<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import type { Attachment } from "@nerita/shared/composer";
	import { fileIcon } from "./fileIcon";
	import Tooltip from "../../ui/Tooltip.svelte";

	let {
		files,
		disabled,
		onOpen,
		onRemove,
	}: {
		files: Attachment[];
		disabled: boolean;
		onOpen: (id: string) => void;
		onRemove: (id: string) => void;
	} = $props();
</script>

{#if files.length > 0}
	<div
		class="attachments mb-[8px] flex flex-wrap gap-[6px]"
		aria-label="添付ファイル"
	>
		{#each files as file (file.id)}
			{@const Icon = fileIcon(file.name)}
			<span
				class="attachment inline-flex max-w-full rounded-[5px] border border-solid border-panel-border [&_svg]:shrink-0"
			>
				<Tooltip content={file.uri}
					>{#snippet children({ props })}<button
							{...props}
							type="button"
							{disabled}
							aria-label={`${file.name} を開く`}
							class="inline-flex min-w-0 flex-1 items-center gap-[5px] border-0 bg-transparent px-[5px] py-[4px] text-[12px]"
							onclick={() => onOpen(file.id)}
							><Icon size={14} aria-hidden="true" /><span
								class="truncate">{file.name}</span
							></button
						>{/snippet}</Tooltip
				>
				<button
					type="button"
					{disabled}
					aria-label={`${file.name} を取り外す`}
					class="inline-flex min-w-0 items-center gap-[5px] border-0 bg-transparent px-[5px] py-[4px] text-[12px]"
					onclick={() => onRemove(file.id)}
				>
					<X size={12} aria-hidden="true" />
				</button>
			</span>
		{/each}
	</div>
{/if}
