<!-- Host の判定結果・理由・正規化したパス・解析できない範囲を表示する。 -->
<script lang="ts">
	import { type GuardReply } from "@nerita/shared/guardrails/messages";

	let {
		result,
	}: {
		result: NonNullable<Extract<GuardReply, { type: "reply" }>["result"]>;
	} = $props();
</script>

<h3 class="m-0 text-[14px]">判定結果</h3>
<strong
	class={[
		"rounded border border-panel-border bg-input p-3 text-lg",
		{
			"text-tool-error": result.action === "deny",
			"text-warning": result.action === "ask",
		},
	]}
	>{{ deny: "拒否", ask: "承認が必要", allow: "許可" }[result.action]}
	<span class="text-[12px]">{result.action}</span></strong
>
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
{/each}
{#each result.uncertainties as text (text)}
	<p class="m-0 text-[13px] text-warning">{text}</p>
{/each}
