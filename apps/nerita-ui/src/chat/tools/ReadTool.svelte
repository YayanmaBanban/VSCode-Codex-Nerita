<!-- 読み取りツールの範囲と本文をテキストで表示する。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import { isRecord } from "@nerita/shared/validation";
	import Value from "./Value.svelte";
	import { toolLabelClass } from "./toolStyles";

	let { tool }: { tool: ToolSummary } = $props();
	const input = $derived(isRecord(tool.rawInput) ? tool.rawInput : {});
	const limitUnit = $derived(tool.kind === "list" ? "件" : "行");
	const texts = $derived(
		(tool.content ?? []).flatMap((part) =>
			part.type === "content" ? [part.content.text] : [],
		),
	);

	/** 空の結果と実行中・停止・失敗を区別する。 */
	function emptyOutputMessage(status: ToolSummary["status"]) {
		if (status === "in_progress" || status === "pending") {
			return "結果を待っています。";
		}
		if (status === "cancelled") {
			return "処理を停止しました。";
		}
		if (status === "failed") {
			return "処理に失敗しました。";
		}
		return "出力はありません。";
	}
</script>

{#if typeof input.offset === "number" || typeof input.limit === "number"}
	<p class={toolLabelClass}>
		{typeof input.offset === "number"
			? `開始行: ${input.offset} `
			: ""}{typeof input.limit === "number"
			? `上限: ${input.limit}${limitUnit}`
			: ""}
	</p>
{/if}
{#if texts.length > 0}
	<Value value={texts.join("\n\n")} />
{:else}
	<p class={`${toolLabelClass} text-muted`}>
		{emptyOutputMessage(tool.status)}
	</p>
{/if}
