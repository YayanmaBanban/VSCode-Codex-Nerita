<script lang="ts">
	// Worktree の実行先と管理操作を表示し、パスの任意入力は提供しない。
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";
	import { backendWorkspaceTrusted } from "@nerita/shared/backend";
	let { ui }: { ui: ReturnType<typeof useDlcWorkspace> } = $props();
	let selected = $derived(ui.selected);
	let target = $derived(
		ui.view.targets.find((item) => item.id === ui.view.targetId),
	);
	let active = $derived(
		ui.view.running.some((run) => run.intentId === selected?.intentId),
	);
</script>

<div class="mt-3 flex min-w-0 flex-wrap items-center gap-2">
	<label class="flex min-w-0 items-center gap-2"
		>Worktree
		<select
			id="dlc-worktree"
			aria-label="DLC の Worktree"
			class="max-w-full min-w-0"
			value={ui.view.targetId ?? ""}
			disabled={!selected || active || ui.view.assignmentPending}
			onchange={(event) => {
				if (selected) {
					ui.send({
						type: "dlc/target",
						requestId: crypto.randomUUID(),
						intentId: selected.intentId,
						revision: selected.revision,
						targetId: event.currentTarget.value,
					});
				}
			}}
		>
			{#each ui.view.targets as item (item.id)}<option value={item.id}
					>{item.main ? "main" : item.name}{backendWorkspaceTrusted(
						ui.view.backend,
						() => item.trusted,
					)
						? ""
						: "（未信頼）"}</option
				>{/each}
		</select>
	</label>
	<button
		type="button"
		disabled={ui.view.assignmentPending}
		title="main の HEAD から作成します。未コミットの変更は含みません。"
		onclick={() =>
			ui.send({
				type: "dlc/worktreeCreate",
				requestId: crypto.randomUUID(),
			})}>Worktree を作成</button
	>
	{#if target && !backendWorkspaceTrusted(ui.view.backend, () => target.trusted)}<button
			type="button"
			onclick={() =>
				ui.send({ type: "dlc/trust", requestId: crypto.randomUUID() })}
			>実行先の信頼を確認</button
		>{/if}
	{#if target?.removable === true}<button
			type="button"
			disabled={ui.view.targetBusy || active}
			onclick={() => {
				ui.send({
					type: "dlc/worktreeRemove",
					requestId: crypto.randomUUID(),
					targetId: target.id,
				});
			}}>Worktree を削除</button
		>{/if}
	{#if target}<p class="m-0 w-full text-[11px] break-all text-muted">
			実行ディレクトリ: {target.directory}
		</p>{/if}
	{#if ui.view.targetBusy && !active}<p
			role="status"
			class="m-0 w-full text-muted"
		>
			この Worktree では別の実行が進行中です。
		</p>{/if}
	{#if ui.view.assignmentPending}<p
			role="status"
			class="m-0 w-full text-muted"
		>
			実行先を保存しています。
		</p>{/if}
</div>
