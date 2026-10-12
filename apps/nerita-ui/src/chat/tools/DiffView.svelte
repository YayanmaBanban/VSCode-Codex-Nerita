<!-- 差分の見出し・範囲・行番号を表示し、作業ツリーの差分を Host で開く。 -->
<script lang="ts">
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import ChangeCount from "./ChangeCount.svelte";
	import type { Snippet } from "svelte";
	import { mergeProps } from "bits-ui";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import {
		changeCount,
		diffPath,
		type DiffHunk,
		type DiffLocationProps,
	} from "./diffPresentation";
	import DiffHunkView from "./DiffHunkView.svelte";
	let {
		path,
		cwd,
		send,
		hunks,
		children,
	}: DiffLocationProps & {
		hunks: DiffHunk[] | undefined;
		children?: Snippet;
	} = $props();
	const name = $derived(
		nonEmptyString(path.replaceAll("\\", "/").split("/").at(-1)) ?? path,
	);
	const fullPath = $derived(diffPath(path, cwd));
	const total = $derived(
		hunks && changeCount(hunks.flatMap((hunk) => hunk.lines)),
	);
</script>

<section class="tool-diff" aria-label={`${path} の差分`}>
	<div
		class="my-[8px] flex min-w-0 items-center justify-between gap-[12px] text-[12px]"
	>
		<SettingsTooltip content={fullPath}
			>{#snippet children({ props })}<button
					{...mergeProps(props, {
						onclick: () =>
							send?.({
								type: "diff/open",
								requestId: crypto.randomUUID(),
								path: fullPath,
							}),
					})}
					type="button"
					aria-label={`${name} の作業ツリー差分を開く`}
					disabled={!send}
					class="border-button-border min-w-0 cursor-pointer truncate rounded-[4px] border border-solid bg-transparent px-[8px] py-[5px] text-left text-[12px] focus-visible:outline-2 focus-visible:outline-focus enabled:hover:border-focus disabled:cursor-default disabled:opacity-60"
					>{name}</button
				>{/snippet}</SettingsTooltip
		>
		{#if total}<ChangeCount {...total} />{/if}
	</div>
	{#each hunks ?? [] as hunk, index (index)}
		<DiffHunkView {hunk} />
	{/each}
	{@render children?.()}
</section>
