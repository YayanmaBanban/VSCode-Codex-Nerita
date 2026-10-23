<!-- サイドバーの配置を同じキーボード対応サブメニューで選ぶ。 -->
<script lang="ts">
	import Columns2 from "@lucide/svelte/icons/columns-2";
	import type { SidebarLocation } from "@nerita/shared/sidebar";
	import SelectionSubmenu from "./SelectionSubmenu.svelte";

	let {
		location,
		onSelect,
	}: {
		location: SidebarLocation;
		onSelect: (value: SidebarLocation) => void;
	} = $props();
</script>

<SelectionSubmenu
	label="サイドバー"
	value={location}
	options={[
		["primary", "プライマリ"],
		["secondary", "セカンダリ"],
	]}
	{onSelect}
>
	{#snippet icon()}
		<Columns2 size={16} aria-hidden="true" />
	{/snippet}
</SelectionSubmenu>
