<!-- 閉じたサイドバーの検索アイコンを、共通の検索付き選択部品へ接続する。 -->
<script lang="ts">
	import SearchableComboList from "./SearchableComboList.svelte";

	let {
		label,
		items,
		selected,
		query = $bindable(""),
		disabled,
		onSelect,
		emptyMessage,
	}: {
		label: string;
		items: { id: string; name: string; description?: string }[];
		selected: string;
		query?: string;
		disabled: boolean;
		onSelect: (id: string) => void;
		emptyMessage: string;
	} = $props();
</script>

<SearchableComboList
	{label}
	appearance="icon"
	side="right"
	options={items.map((item) => ({
		value: item.id,
		name: item.name,
		description: item.description,
	}))}
	value={selected}
	onChange={onSelect}
	bind:query
	{disabled}
	{emptyMessage}
/>
