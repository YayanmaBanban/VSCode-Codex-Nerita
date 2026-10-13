<!-- 承認の長いコードを、読み取り専用でキーボードでもスクロールできる領域に収める。 -->
<script lang="ts">
	import { cn } from "cnfast";

	let { label, value }: { label: string; value: string } = $props();
</script>

<div role="region" aria-label={label}>
	<div
		role="textbox"
		aria-label={label}
		aria-readonly="true"
		aria-multiline="true"
		tabindex="0"
		class={cn(
			"m-0 max-h-[200px] max-w-full min-w-0 overflow-auto rounded-[6px] border border-solid",
			"border-panel-border bg-input p-[10px] font-mono text-[12px] leading-[1.6]",
			"[overflow-wrap:normal]",
			"whitespace-pre text-input-text",
		)}
	>
		<pre class="m-0 font-[inherit]"><code>{value}</code></pre>
	</div>
</div>
