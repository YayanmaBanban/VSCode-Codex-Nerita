<!-- パス全体をツールチップに表示し、ハンクの行範囲をファイル名に添えて作業ツリーの差分を開く。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import { mergeProps } from "bits-ui";
	import SettingsTooltip from "../SettingsTooltip.svelte";
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

<SettingsTooltip content={fullPath}>
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
				"bg-secondary px-[6px] py-[2px] text-left text-[12px]",
				"focus-visible:outline-2 focus-visible:outline-focus",
				"enabled:cursor-pointer",
				"enabled:hover:border-focus",
				"disabled:cursor-default disabled:opacity-60",
			)}
			><span class="truncate">{name}</span
			>{#if isNonEmptyString(range)}<span class="shrink-0 tabular-nums"
					>({range})</span
				>{/if}</button
		>
	{/snippet}
</SettingsTooltip>
