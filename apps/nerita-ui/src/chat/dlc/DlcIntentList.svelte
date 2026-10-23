<!-- Intent の状態と保留理由を表示し、作成・選択・再読み込みを Host へ要求する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import { cubicBezier } from "motion";
	import { prefersReducedMotion } from "svelte/motion";
	import { slide } from "svelte/transition";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import DlcIntentButton from "./DlcIntentButton.svelte";
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";

	let { ui }: { ui: ReturnType<typeof useDlcWorkspace> } = $props();
	const holdEasing = cubicBezier(0.22, 1, 0.36, 1);
</script>

<aside
	aria-label="Intent 一覧"
	class={cn(
		"flex min-h-0 flex-col gap-3 overflow-auto border-0 border-r border-solid border-panel-border",
		"bg-menu/30 p-3",
		"@max-[600px]:max-h-[32vh] @max-[600px]:border-r-0 @max-[600px]:border-b",
	)}
>
	<div class="flex items-center gap-1">
		<SettingsTooltip content="Intentの作成">
			{#snippet children({ props })}
				<button
					{...props}
					type="button"
					aria-label="Intentの作成"
					class={cn(
						"inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit",
						"hover:bg-settings-hover",
					)}
					disabled={ui.creation.pending}
					onclick={() => ui.creation.setCreating(true)}
					><Plus size={16} aria-hidden="true" /></button
				>
			{/snippet}
		</SettingsTooltip>
		<SettingsTooltip content="再読み込み">
			{#snippet children({ props })}
				<button
					{...props}
					type="button"
					aria-label="再読み込み"
					class={cn(
						"inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit",
						"hover:bg-settings-hover",
					)}
					onclick={() =>
						ui.send({
							type: "dlc/read",
							requestId: crypto.randomUUID(),
						})}><RotateCw size={16} aria-hidden="true" /></button
				>
			{/snippet}
		</SettingsTooltip>
	</div>
	<nav aria-label="Intent の選択" class="flex flex-col gap-2">
		{#if ui.view.intents.length === 0}
			<p class="text-muted">Intentがありません</p>
		{/if}
		{#each ui.view.intents as intent (intent.intentId)}
			{@const selected = intent.intentId === ui.selected?.intentId}
			<div
				class={cn(
					"dlc-intent-card min-w-0 overflow-hidden rounded-md border border-solid",
					selected
						? "border-focus bg-message-user"
						: "border-panel-border bg-secondary",
				)}
			>
				<DlcIntentButton {intent} {ui} />
				{#if intent.startHold && selected}
					<!-- 閉じる途中の操作無効化は Svelte のトランジションに委ねる。 -->
					<div
						transition:slide={{
							duration: prefersReducedMotion.current ? 0 : 220,
							easing: holdEasing,
						}}
						aria-label="実行開始の保留"
						class="dlc-intent-hold overflow-hidden"
					>
						<div
							class="mx-3 flex flex-col gap-2 border-0 border-t border-solid border-panel-border pt-2 pb-3 text-[12px]"
						>
							<p role="status" class="m-0 flex items-start gap-2">
								<TriangleAlert
									size={16}
									class="mt-0.5 shrink-0 text-warning"
									aria-hidden="true"
								/>
								<span class="min-w-0 break-words text-muted"
									>{intent.startHold.message}</span
								>
							</p>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</nav>
</aside>
