<!-- 実行環境の設定を依頼本文から切り離し、Intent ごとの割当を要求する。 -->
<script lang="ts">
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";
	import WorktreeControls from "./DlcWorktrees.svelte";

	let { ui }: { ui: ReturnType<typeof useDlcWorkspace> } = $props();
	/** 選択したバックエンドを検証し、現在の依頼とリビジョンを付けて変更を要求する。 */
	function backendChanged(event: Event) {
		if (!(event.currentTarget instanceof HTMLSelectElement)) {
			return;
		}
		const backend = event.currentTarget.value;
		if (backend !== "pi" && backend !== "codex") {
			return;
		}
		if (backend !== ui.view.backend) {
			ui.send({
				type: "dlc/backend",
				requestId: crypto.randomUUID(),
				intentId: ui.selected?.intentId ?? null,
				revision: ui.selected?.revision ?? null,
				backend,
			});
		}
	}
</script>

<header class="mb-5">
	<h1 class="my-2 text-[20px] font-semibold break-words">
		{ui.selected?.title ?? ""}
	</h1>
	<div class="flex flex-wrap items-center gap-3 text-muted">
		<span
			>管理元: {ui.view.environment?.workspace ?? "確認中"} / {ui.view
				.environment?.branch ?? "ブランチ未取得"}</span
		>
		<label class="flex items-center gap-2"
			>バックエンド<select
				aria-label="DLC のバックエンド"
				value={ui.view.backend}
				disabled={ui.selected === null ||
					ui.view.assignmentPending ||
					ui.view.running.some(
						(run) => run.intentId === ui.selected?.intentId,
					)}
				onchange={backendChanged}
				><option value="codex">Codex</option><option value="pi"
					>Pi</option
				></select
			></label
		>
	</div>
	<WorktreeControls {ui} />
</header>
