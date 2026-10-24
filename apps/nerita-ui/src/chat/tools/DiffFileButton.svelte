<!-- パス全体をツールチップに表示し、ハンクの行範囲をファイル名に添えて作業ツリーの差分を開く。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import { mergeProps } from "bits-ui";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { diffPath, type DiffLocationProps } from "./diffPresentation";

	let { path, cwd, send, range }: DiffLocationProps & { range?: string } =
		$props();
	const name = $derived(
		nonEmptyString(path.replaceAll("\\", "/").split("/").at(-1)) ?? path,
	);
	const fullPath = $derived(diffPath(path, cwd));
	const label = $derived(
		isNonEmptyString(range) ? `${name} (${range})` : name,
	);
</script>

<Tooltip content={fullPath}>
	{#snippet children({ props })}
		<button
			{...mergeProps(props, {
				onclick: () =>
					send?.({
						type: "diff/open",
						requestId: crypto.randomUUID(),
						path: fullPath,
					}),
			})}
			type="button"
			aria-label={`${label} の作業ツリー差分を開く`}
			disabled={!send}
			class={cn(
				"border-button-border inline-flex min-w-0 items-center gap-[4px] rounded-[4px] border border-solid",
				"bg-gray-700 px-[6px] py-[2px] text-left text-[12px] text-white",
				"focus-visible:outline-2 focus-visible:outline-focus",
				"enabled:cursor-pointer",
				"enabled:hover:border-focus enabled:hover:bg-gray-600",
				"disabled:cursor-default disabled:opacity-60",
			)}
			><span class="truncate">{name}</span
			>{#if isNonEmptyString(range)}<span class="shrink-0 tabular-nums"
					>({range})</span
				>{/if}</button
		>
	{/snippet}
</Tooltip>
