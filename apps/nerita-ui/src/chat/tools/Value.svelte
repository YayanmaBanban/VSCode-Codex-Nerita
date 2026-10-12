<!-- 任意のツール値を文字列として表示し、Markdown や HTML として実行しない。 -->
<script lang="ts">
	import CommandOutput from "./CommandOutput.svelte";
	import { toolOutputClass } from "./toolStyles";
	let {
		value,
		scrollable = false,
	}: { value: unknown; scrollable?: boolean } = $props();
	const formatted: string | undefined = $derived(
		typeof value === "string" ? value : JSON.stringify(value, null, 2),
	);
</script>

{#if scrollable}<CommandOutput
		text={typeof formatted === "string" ? formatted : ""}
	/>{:else}<pre class={toolOutputClass}>{formatted ?? ""}</pre>{/if}
