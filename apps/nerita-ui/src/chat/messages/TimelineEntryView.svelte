<!-- 一つのタイムライン行をメッセージ・ツール・子スレッドへ振り分ける。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { ToolSummary } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { SubAgentSummary } from "@nerita/shared/subAgents";
	import type { TimelineEntry } from "./messageTimeline";
	import MessageEntry from "./MessageEntry.svelte";
	let {
		entry,
		renderTool,
		renderAgent,
		send,
		jump,
		register,
	}: {
		entry: TimelineEntry;
		renderTool?: Snippet<[ToolSummary]> | undefined;
		renderAgent?: Snippet<[SubAgentSummary]> | undefined;
		send?: ((message: UiMessage) => void) | undefined;
		jump: (id: string) => void;
		register: (id: string, element: HTMLElement) => () => void;
	} = $props();
</script>

{#if entry.kind === "agent"}{@render renderAgent?.(entry.agent)}
{:else if entry.kind === "tool"}
	{#if entry.tool.parentToolCallId}<div
			class="nested-tool my-[8px] border-0 border-l border-solid border-panel-border pl-[12px]"
		>
			<div class="text-[12px] [overflow-wrap:anywhere] text-muted">
				{entry.parent
					? `親ツール: ${entry.parent.title}`
					: "入れ子のツール"}
			</div>
			{@render renderTool?.(entry.tool)}
		</div>
	{:else}{@render renderTool?.(entry.tool)}{/if}
{:else}<MessageEntry
		message={entry.message}
		{send}
		target={entry.previousUser}
		{jump}
		{register}
	/>{/if}
