<script lang="ts">
	// 工程の保存状態を進めず、Phase ごとに集計と利用者の展開位置を表示する。
	import type { Snippet } from "svelte";
	import type {
		DlcAction,
		DlcProjection,
		DlcView,
	} from "@nerita/shared/dlc/contracts";
	import type { UiMessage } from "@nerita/shared/messages";
	import DlcWorkItems from "./DlcWorkItems.svelte";
	import {
		phases,
		selectionLabels,
		statusLabels,
		executionBusy,
		phaseExecutionStatus,
	} from "./phaseModel";
	let {
		selected,
		view,
		expanded,
		onToggle,
		action,
		send,
		initialization,
		conversation,
	}: {
		selected: DlcProjection | null;
		view: DlcView;
		expanded: number[];
		onToggle: (phase: number) => void;
		action: (action: DlcAction) => void;
		send: (message: UiMessage) => void;
		initialization: Snippet;
		conversation: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-3">
	{#each phases as name, phase (phase)}
		{@const stages =
			selected?.stages.filter((stage) =>
				stage.id.startsWith(`${phase}.`),
			) ?? []}
		{@const open = expanded.includes(phase)}
		{@const pending = stages.some(
			(stage) => stage.status === "pending" && stage.selection !== "skip",
		)}
		<section
			class="overflow-hidden rounded-lg border border-solid border-panel-border"
		>
			<h2 class="m-0 text-[13px]">
				<button
					type="button"
					disabled={selected === null}
					aria-expanded={open}
					aria-controls={`dlc-phase-${phase}`}
					class="flex w-full items-center gap-2 rounded-none border-0 bg-transparent px-4 py-3 text-left"
					onclick={() => onToggle(phase)}
				>
					<span aria-hidden="true">{open ? "▾" : "▸"}</span><span
						class="flex-1">Phase {phase} · {name}</span
					><span class="text-[11px] font-normal text-muted"
						>{phaseExecutionStatus(
							stages,
							phase,
							view,
							selected,
						)}</span
					>
				</button>
			</h2>
			<div
				id={`dlc-phase-${phase}`}
				hidden={!open}
				class="border-0 border-t border-solid border-panel-border px-4 py-3"
			>
				{#if phase === 0}{@render initialization()}{/if}
				{#if selected !== null}
					<ul aria-label="工程の適用と進行" class="m-0 list-none p-0">
						{#each stages as stage (stage.id)}<li
								class="border-0 border-b border-solid border-panel-border py-2 last:border-b-0"
							>
								<div
									class="flex flex-wrap items-center justify-between gap-2"
								>
									<strong class="text-[12px]"
										>{stage.id} {stage.name}</strong
									><span class="text-muted"
										>{selectionLabels[stage.selection]} · {statusLabels[
											stage.status
										]}</span
									>
								</div>
								<p
									class="m-0 mt-1 text-[11px] break-words text-muted"
								>
									{stage.reason}
								</p>
							</li>{/each}
					</ul>
					{#if phase === 3}<DlcWorkItems
							{selected}
							active={executionBusy(view, selected)}
							{action}
							{send}
						/>{@render conversation()}{/if}
				{/if}
				{#if phase > 0 && pending}<p class="text-muted">
						この Phase の工程実行は後続フェーズで対応します。
					</p>{/if}
			</div>
		</section>
	{/each}
</div>
