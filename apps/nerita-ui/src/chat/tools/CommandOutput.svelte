<!-- Host が制限した一範囲を表示し、その範囲だけをコピーする。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import CopyButton from "../CopyButton.svelte";
	import { toolOutputClass } from "./toolStyles";
	let {
		text,
		copyDisabled = false,
	}: { text: string; copyDisabled?: boolean } = $props();
</script>

<div class="relative">
	<div
		role="region"
		aria-label="出力"
		class="max-h-[400px] overflow-auto rounded-[4px] border border-solid border-panel-border p-[8px] pr-[44px]"
	>
		<pre class={cn(toolOutputClass, "m-0")}>{text}</pre>
	</div>
	<CopyButton
		{text}
		label="出力をコピー"
		disabled={copyDisabled}
		className="absolute top-[5px] right-[20px] size-[28px]"
	/>
</div>
