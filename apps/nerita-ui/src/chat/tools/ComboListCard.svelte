<!-- 推論・参照・検索カードを縦線付きの開閉表示へまとめる。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { ToolSummary } from "@nerita/shared/chatState";
	import ToolCardCollapse from "./ToolCardCollapse.svelte";
	import "./comboListCard.css";

	let {
		tool,
		icon: Icon,
		open,
		bodyId,
		onToggle,
		children,
	}: {
		tool: ToolSummary;
		icon: typeof ChevronDown;
		open: boolean;
		bodyId: string;
		onToggle: () => void;
		children: Snippet;
	} = $props();
	const labels = {
		pending: "待機中",
		in_progress: "実行中",
		completed: "",
		cancelled: "停止",
		unfinished: "未完了",
		failed: "失敗",
		unknown: "結果不明",
	};
</script>

<div
	class="tool-card combo-list-card my-[8px]"
	data-kind={tool.kind}
	data-status={tool.status}
	data-open={open}
>
	<button
		type="button"
		class="tool-heading group flex w-full min-w-0 cursor-pointer items-center gap-[10px] rounded-[4px] border-0 bg-transparent px-0 py-[6px] text-left text-[12px] text-inherit hover:bg-menu-hover focus-visible:outline-1 focus-visible:outline-focus data-highlighted:bg-menu-hover"
		aria-expanded={open}
		aria-controls={bodyId}
		onclick={onToggle}
	>
		<Icon size={16} class="shrink-0" aria-hidden="true" /><span
			class="min-w-0 [overflow-wrap:anywhere]">{tool.title}</span
		>{#if tool.status !== "completed"}<span class="shrink-0 text-[11px]"
				>{labels[tool.status]}</span
			>{/if}<ChevronDown
			size={12}
			class="combo-list-chevron shrink-0"
			aria-hidden="true"
		/>
	</button>
	<ToolCardCollapse id={bodyId} className="combo-list-collapse" {open}
		><div
			class="tool-body ml-[7px] flex flex-col gap-[12px] border-0 border-l border-solid border-panel-border py-[6px] pr-[4px] pl-[18px] text-[12px] leading-[1.65]"
		>
			{@render children()}
		</div></ToolCardCollapse
	>
</div>
