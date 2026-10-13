<!-- 検索語は検索リンクにし、URL は HTTP(S) だけを直接開く。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";

	let { tool }: { tool: ToolSummary } = $props();
	const label = $derived(tool.searchLabel ?? "");
	const href = $derived(
		/^https?:\/\//i.test(label)
			? label
			: `https://www.google.com/search?q=${encodeURIComponent(label)}`,
	);
</script>

{#if label}<a
		class="[overflow-wrap:anywhere] text-link underline underline-offset-2"
		{href}
		target="_blank"
		rel="noreferrer noopener">{label}</a
	>{/if}
