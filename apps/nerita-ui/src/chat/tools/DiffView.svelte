<!-- 各ハンクのファイル操作と行範囲をまとめ、解析できない差分にもファイル操作を残す。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { DiffHunk, DiffLocationProps } from "./diffPresentation";
	import DiffHunkView from "./DiffHunkView.svelte";
	import DiffFileButton from "./DiffFileButton.svelte";

	let {
		hunks,
		children,
		...location
	}: DiffLocationProps & {
		hunks: DiffHunk[] | undefined;
		children?: Snippet;
	} = $props();
</script>

<section class="tool-diff min-w-0" aria-label={`${location.path} の差分`}>
	{#if !hunks || hunks.length === 0}<div
			class="my-[8px] flex min-w-0 items-center text-[12px]"
		>
			<DiffFileButton {...location} />
		</div>{/if}
	{#each hunks ?? [] as hunk, index (index)}
		<DiffHunkView {hunk} {...location} />
	{/each}
	{@render children?.()}
</section>
