<!-- Host が選別した Contribution を order と ID の順で配置する。 -->
<script lang="ts">
	import { nonZeroNumber } from "@nerita/shared/valuePredicates";
	import type { NeritaUiSlot } from "@nerita/shared/uiContributions";
	import type { ContributionSlotProps } from "./contributionProps";
	import ContributionRenderer from "./ContributionRenderer.svelte";
	let {
		name,
		contributions,
		...props
	}: ContributionSlotProps & { name: NeritaUiSlot } = $props();
	let items = $derived(
		contributions.items
			.filter((item) => item.slot === name)
			.sort(
				(a, b) =>
					nonZeroNumber((a.order ?? 0) - (b.order ?? 0)) ??
					a.id.localeCompare(b.id),
			),
	);
</script>

{#each items as item (item.id)}<ContributionRenderer
		control={item.control}
		{...props}
	/>{/each}
