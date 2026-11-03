<!-- エージェント固有の固定項目と未保存項目を、共通の検索サイドバーへ渡す。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
	import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
	import SearchableSelectionListSidebar from "../ui/SearchableSelectionListSidebar.svelte";

	let {
		agents,
		selected,
		onSelect,
		busy,
		defaults = false,
		children,
	}: {
		agents: ManagedAgent[];
		selected: string;
		onSelect: (id: string) => void;
		busy: boolean;
		defaults?: boolean;
		children: Snippet;
	} = $props();
	let items = $derived([
		...agents,
		...(selected === "new"
			? [{ id: "new", name: "新しい Agent", description: "未保存の定義" }]
			: []),
	]);
</script>

<SearchableSelectionListSidebar
	label="エージェント"
	title="Agents"
	{items}
	{selected}
	{onSelect}
	disabled={busy}
	pinnedItem={defaults
		? {
				id: "defaults",
				name: "Workspace defaults",
				description: "プロジェクト共通の設定",
			}
		: undefined}
	emptyMessage="Agent 定義がありません。"
>
	{#snippet pinnedIcon()}
		<SlidersHorizontal
			size={14}
			class="shrink-0 text-muted"
			aria-hidden="true"
		/>
	{/snippet}
	{@render children()}
</SearchableSelectionListSidebar>
