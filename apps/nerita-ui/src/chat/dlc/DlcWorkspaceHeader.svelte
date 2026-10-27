<!-- 実行環境の設定を依頼本文から切り離し、Intent ごとの割当を要求する。 -->
<script lang="ts">
	import type { useDlcWorkspace } from "./useDlcWorkspace.svelte";
	import WorktreeControls from "./DlcWorktrees.svelte";
	import ConfigControl from "../composer/ConfigControl.svelte";

	let { ui }: { ui: ReturnType<typeof useDlcWorkspace> } = $props();
	/** 選択したバックエンドを検証し、現在の依頼とリビジョンを付けて変更を要求する。 */
	function backendChanged(backend: string) {
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
	<div class="flex flex-wrap gap-2 text-[12px]">
		<span
			class="max-w-full rounded-[5px] bg-message-code px-2 py-[6px] leading-none [overflow-wrap:anywhere] text-foreground"
		>
			{ui.view.environment?.workspace ?? "ワークスペースの確認中"}
		</span>
		<span
			class="max-w-full rounded-[5px] bg-message-code px-2 py-[6px] leading-none [overflow-wrap:anywhere] text-foreground"
		>
			{ui.view.environment?.branch ?? "ブランチの確認中"}
		</span>
	</div>
	<section
		class="mt-4 rounded-[8px] border border-solid border-input-border p-3"
		aria-label="実行環境"
	>
		<h2 class="m-0 mb-4 text-[13px] font-semibold">実行環境</h2>
		<div
			class="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] items-center gap-3 text-[13px]"
		>
			<span>バックエンド</span>
			<ConfigControl
				appearance="field"
				option={{
					id: "dlc-backend",
					name: "DLC のバックエンド",
					currentValue: ui.view.backend,
					options: [
						{ name: "Codex", value: "codex" },
						{ name: "Pi", value: "pi" },
					],
				}}
				disabled={ui.selected === null ||
					ui.view.assignmentPending ||
					ui.view.running.some(
						(run) => run.intentId === ui.selected?.intentId,
					)}
				onChange={backendChanged}
			/>
		</div>
		<WorktreeControls {ui} />
	</section>
</header>
