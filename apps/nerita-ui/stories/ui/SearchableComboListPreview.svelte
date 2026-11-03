<!-- 多数の候補と選択値だけを用意し、検索・開閉・キーボード操作は共通部品で確認する。 -->
<script lang="ts">
	import SearchableComboList from "../../src/ui/SearchableComboList.svelte";

	let {
		appearance = "field",
		disabled = false,
		empty = false,
		count = 120,
	}: {
		appearance?: "field" | "icon";
		disabled?: boolean;
		empty?: boolean;
		count?: number;
	} = $props();
	let value = $state("item-001");
	let options = $derived(
		empty
			? []
			: Array.from({ length: count }, (_, index) => ({
					value: `item-${String(index + 1).padStart(3, "0")}`,
					name: `Item ${String(index + 1).padStart(3, "0")}`,
					description: `候補の説明 ${index + 1}`,
					disabled: index === 1,
				})),
	);
</script>

<div class="mx-auto flex max-w-lg flex-col gap-4 p-6 text-foreground">
	<SearchableComboList
		label="候補"
		{appearance}
		{disabled}
		{value}
		{options}
		onChange={(next: string) => {
			value = next;
		}}
	/>
	<output aria-label="選択値">{value}</output>
</div>
