<!-- 見出しのタイトル・進行中アイコン・完了や停止状態を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Check from "@lucide/svelte/icons/check";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import type { ToolSummary } from "@nerita/shared/chatState";
	import { toolChangeCount } from "./diffPresentation";
	import ChangeCount from "./ChangeCount.svelte";

	let {
		tool,
		status,
		icon: Icon,
		active,
		progress,
		expandable,
		reserveStatusSpace,
	}: {
		tool: ToolSummary;
		status: ToolSummary["status"];
		icon: typeof ChevronDown;
		active: boolean;
		progress: boolean;
		expandable: boolean;
		reserveStatusSpace: boolean;
	} = $props();
	const inactiveLabels: Partial<Record<ToolSummary["status"], string>> = {
		cancelled: "停止",
		unknown: "結果不明",
		unfinished: "未完了",
	};
	const inactiveLabel = $derived(inactiveLabels[status] ?? "");
	const changes = $derived(toolChangeCount(tool.content));
</script>

<Icon size={16} aria-hidden="true" />
<span class="tool-title flex min-w-0 flex-1 items-center gap-[8px]"
	><span class="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap"
		>{tool.title}</span
	>{#if changes}<ChangeCount {...changes} />{/if}</span
>
{#if progress && active}
	<LoaderCircle
		size={16}
		class="status-indicator-running"
		role="img"
		aria-label="実行中"
	/>
{/if}
{#if !progress && active}
	<span class="tool-status text-[12px] whitespace-nowrap text-muted">
		{tool.status === "pending" ? "待機中" : "実行中"}
	</span>
{/if}
{#if inactiveLabel !== ""}
	<span class="tool-status text-[12px] whitespace-nowrap text-muted">
		{inactiveLabel}
	</span>
{/if}
{#if status === "completed"}
	<Check size={16} role="img" aria-label="完了" />
{/if}
{#if expandable}
	<ChevronDown
		size={14}
		class={cn(
			"tool-chevron group-aria-[expanded=false]:-rotate-90",
			reserveStatusSpace ? "ml-[26px]" : "",
		)}
		aria-hidden="true"
	/>
{/if}
