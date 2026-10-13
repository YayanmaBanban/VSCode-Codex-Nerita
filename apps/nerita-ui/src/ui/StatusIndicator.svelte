<!-- 機能に依存せず、進行・完了・注意・エラー・待機を共通アイコンで表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Check from "@lucide/svelte/icons/check";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import X from "@lucide/svelte/icons/x";
	import type { StatusIndicatorState } from "./statusIndicatorModel";
	import "./status-indicator.css";
	/** 状態名の読み上げと説明は呼び出し元に任せる。 */
	let { status }: { status: StatusIndicatorState } = $props();
</script>

{#if status === "running"}
	<LoaderCircle
		size={16}
		aria-hidden="true"
		class="status-indicator-running shrink-0"
	/>
{:else if status === "completed"}
	<Check size={16} aria-hidden="true" class="shrink-0 text-menu-check" />
{:else if status === "error"}
	<X size={16} aria-hidden="true" class="shrink-0 text-tool-error" />
{:else}
	<span
		aria-hidden="true"
		class={cn(
			"status-indicator-dots flex h-4 w-4 shrink-0 items-center justify-between",
			status === "warning" ? "text-warning" : "text-foreground",
		)}
	>
		<span class="size-1 rounded-full bg-current"></span>
		<span class="size-1 rounded-full bg-current"></span>
		<span class="size-1 rounded-full bg-current"></span>
	</span>
{/if}
