<!-- Intent の状態を表示し、作成・選択・保留の解消を Host へ要求する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import DlcIntentButton from "./DlcIntentButton.svelte";
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";

	let { ui }: { ui: ReturnType<typeof useDlcWorkspace> } = $props();
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
		<SettingsTooltip content="Intentの作成"
			>{#snippet children({ props })}<button
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
				>{/snippet}</SettingsTooltip
		>
		<SettingsTooltip content="再読み込み"
			>{#snippet children({ props })}<button
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
				>{/snippet}</SettingsTooltip
		>
	</div>
	<nav aria-label="Intent の選択" class="flex flex-col gap-2">
		{#if ui.view.intents.length === 0}<p class="text-muted">
				Intent がありません。
			</p>{/if}
		{#each ui.view.intents as intent (intent.intentId)}
			<div class="flex flex-col gap-2">
				<DlcIntentButton {intent} {ui} />
				{#if intent.startHold && intent.intentId === ui.selected?.intentId}
					<div
						aria-label="実行開始の保留"
						class="flex flex-col gap-2 rounded-md border border-solid border-panel-border p-2 text-[11px]"
					>
						<p role="status" class="m-0 break-words text-muted">
							{intent.startHold.message}
						</p>
						<a href="#dlc-worktree">実行先を選択</a>
						{#if intent.startHold.reason === "worktree-required"}<button
								type="button"
								onclick={() =>
									ui.send({
										type: "dlc/worktreeCreate",
										requestId: crypto.randomUUID(),
									})}>新しい Worktree を作成</button
							>{/if}
						{#if intent.startHold.reason === "trust-required"}<button
								type="button"
								onclick={() =>
									ui.send({
										type: "dlc/trust",
										requestId: crypto.randomUUID(),
									})}>信頼設定を開く</button
							>{/if}
						<button
							type="button"
							onclick={() =>
								ui.send({
									type: "dlc/read",
									requestId: crypto.randomUUID(),
								})}>開始条件を再確認</button
						>
					</div>
				{/if}
			</div>
		{/each}
	</nav>
</aside>
