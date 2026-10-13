<!-- Host の判定結果・理由・正規化したパス・解析できない範囲を表示する。 -->
<script lang="ts">
	import { type GuardReply } from "@nerita/shared/guardrails/messages";

	let {
		result,
	}: {
		result: NonNullable<Extract<GuardReply, { type: "reply" }>["result"]>;
	} = $props();
</script>

<strong class="text-lg">判定: {result.action}</strong>
<ul class="my-0 pl-5">
	{#each result.reasons as reason, i (i)}
		<li class="break-words">
			{reason}
			<span class="text-[12px] text-muted">({result.rules[i]}) </span>
		</li>
	{/each}
</ul>
{#each result.paths as path (path)}
	<p class="m-0 font-editor text-[12px] break-all">正規化後: {path}</p>
{/each}{#each result.uncertainties as text (text)}
	<p class="m-0 text-[13px] text-warning">{text}</p>
{/each}
