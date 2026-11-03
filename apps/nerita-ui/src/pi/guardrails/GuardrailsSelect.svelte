<!-- ガードレールの選択項目を検索付きコンボボックスに渡し、候補が増えても絞り込めるようにする。 -->
<script lang="ts">
	import SearchableComboList, {
		type SearchableComboOption,
	} from "../../ui/SearchableComboList.svelte";

	let {
		label,
		value,
		options,
		onChange,
		disabled = false,
	}: {
		label: string;
		value: string;
		options: SearchableComboOption[];
		onChange: (value: string) => void;
		disabled?: boolean;
	} = $props();
</script>

<div class="flex min-w-0 flex-col gap-1">
	<span>{label}</span>
	<SearchableComboList {label} {value} {options} {disabled} {onChange} />
</div>
