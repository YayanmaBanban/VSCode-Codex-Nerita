<!-- 共通タブの幅・無効状態を切り替え、選択状態は実コンポーネントの操作で保持する。 -->
<script lang="ts">
	import TabBar from "../../src/ui/TabBar.svelte";

	let {
		width = 260,
		disabled = false,
	}: { width?: number; disabled?: boolean } = $props();
	let selected = $state("overview");
</script>

<div style:width={`${width}px`}>
	<TabBar
		label="確認用タブ"
		value={selected}
		{disabled}
		items={[
			{ value: "overview", label: "概要" },
			{ value: "path", label: "パスルール", count: 9 },
			{ value: "command", label: "コマンドルール", count: 0 },
			{ value: "exceptions", label: "パス例外", count: 2 },
			{ value: "json", label: "JSON" },
		]}
		onChange={(value: string) => (selected = value)}
	/>
</div>
