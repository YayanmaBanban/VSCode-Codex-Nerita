<script lang="ts">
	// 保留理由を説明として残し、実行先とバックエンドを併記する。
	import { cn } from "cnfast";
	import type { IntentSummary } from "@nerita/shared/dlc/contracts";
	import StatusIndicator from "../../ui/StatusIndicator.svelte";
	import type { StatusIndicatorState } from "../../ui/statusIndicatorModel";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";
	let {
		intent,
		ui,
	}: { intent: IntentSummary; ui: ReturnType<typeof useDlcWorkspace> } =
		$props();
	const id = $props.id();
	const labels: Record<IntentSummary["status"], string> = {
		idle: "待機",
		running: "実行中",
		stopping: "停止中",
		review: "レビュー待ち",
		complete: "完了",
		archived: "アーカイブ済み",
		attention: "確認が必要",
	};
	const indicatorStates: Record<
		IntentSummary["status"],
		StatusIndicatorState
	> = {
		idle: "idle",
		running: "running",
		stopping: "warning",
		review: "warning",
		complete: "completed",
		archived: "completed",
		attention: "warning",
	};
	const holdLabels = {
		"worktree-required": "Worktree が必要",
		"trust-required": "信頼の確認が必要",
		unavailable: "開始条件の確認が必要",
	};
	let selected = $derived(intent.intentId === ui.selected?.intentId);
	let target = $derived(
		ui.view.targets.find((item) => item.id === intent.execution?.targetId),
	);
	let statusLabel = $derived(
		intent.startHold
			? holdLabels[intent.startHold.reason]
			: labels[intent.status],
	);
	const executionLabel = $derived.by(() => {
		if (!intent.execution) {
			return "実行先未選択";
		}
		const backend = intent.execution.backend === "pi" ? "Pi" : "Codex";
		return `${target?.name ?? "消失した Worktree"} · ${backend}`;
	});
</script>

<SettingsTooltip content={statusLabel}>
	{#snippet children({ props })}
		<button
			{...props}
			type="button"
			data-intent-id={intent.intentId}
			aria-label={intent.title}
			aria-describedby={id}
			aria-pressed={selected}
			class={cn(
				"flex flex-col gap-2 px-3 py-3 text-left",
				selected && "border-focus bg-message-user",
			)}
			onclick={() => ui.select(intent.intentId)}
		>
			<span {id} class="sr-only">{statusLabel}</span>
			<span class="flex w-full items-center gap-2"
				><StatusIndicator
					status={intent.startHold
						? "warning"
						: indicatorStates[intent.status]}
				/><strong class="min-w-0 break-words">{intent.title}</strong
				></span
			>
			<span class="text-[11px] text-muted">{executionLabel}</span>
		</button>
	{/snippet}
</SettingsTooltip>
