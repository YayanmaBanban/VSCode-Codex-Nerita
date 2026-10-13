<!-- Host がサイズ制限した出力プレビューと詳細取得を表示する。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import ToolContent from "./ToolContent.svelte";
	import ToolOutputView from "./ToolOutputView.svelte";

	let {
		tool,
		send,
		cwd,
	}: {
		tool: ToolSummary;
		send?: ((message: UiMessage) => void) | undefined;
		cwd?: string | null | undefined;
	} = $props();
</script>

{#if tool.output}
	{#if tool.kind !== "execute" && tool.rawInput !== undefined}<ToolContent
			{tool}
			{send}
			{cwd}
		/>{/if}
	<ToolOutputView output={tool.output} />
	{#if tool.exitCode !== undefined}<p class="text-[12px] text-muted">
			終了コード: {tool.exitCode}
		</p>{/if}
{/if}
