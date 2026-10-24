<!-- 組み込み表示とフローティング表示で、検索・開閉・一覧の配置を共有する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import SidebarToggle from "./SidebarToggle.svelte";

	let {
		header,
		expanded,
		onToggle,
		onSelect,
	}: {
		header: Snippet;
		expanded: Snippet<[() => void]>;
		onToggle: () => void;
		onSelect: () => void;
	} = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<div class="flex min-w-0 items-center gap-2">
		<div class="min-w-0 flex-1">
			{@render header()}
		</div>
		<SidebarToggle open {onToggle} />
	</div>
	{@render expanded(onSelect)}
</div>
