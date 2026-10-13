<!-- Intent 一覧と Phase 作業領域を組み立て、実行の寿命は Host に委ねる。 -->
<script lang="ts">
	import type { Bridge } from "@nerita/shared/bridge";
	import IntentForm from "./IntentForm.svelte";
	import IntentOverview from "./IntentOverview.svelte";
	import DlcPhases from "./DlcPhases.svelte";
	import DlcIntentList from "./DlcIntentList.svelte";
	import DlcWorkspaceHeader from "./DlcWorkspaceHeader.svelte";
	import DlcConversation from "./DlcConversation.svelte";
	import { useDlcWorkspace } from "./useDlcWorkspace.svelte";
	import "./dlc.css";
	import "../chat.css";

	let { bridge }: { bridge: Bridge } = $props();
	// Bridge の切替では旧接続の購読を解除する。
	const ui = useDlcWorkspace(() => bridge);
	let error = $derived(ui.view.error ?? ui.editor.error);
</script>

<main
	aria-label="DLC Workspace"
	class="dlc-workspace dlc-panel @container h-dvh text-[12px]"
>
	<div
		class="grid h-full grid-cols-[200px_minmax(0,1fr)] @max-[600px]:grid-cols-1 @max-[600px]:grid-rows-[auto_minmax(0,1fr)]"
	>
		<DlcIntentList {ui} />
		<div class="min-h-0 min-w-0 overflow-auto p-5 @max-[600px]:p-3">
			<DlcWorkspaceHeader {ui} />
			{#if error !== null}<div
					role="alert"
					class="dlc-error mb-3 rounded-md border border-solid border-panel-border"
				>
					{error}
					<div class="dlc-toolbar mt-2">
						<button
							type="button"
							onclick={() =>
								ui.send({
									type: "dlc/read",
									requestId: crypto.randomUUID(),
								})}>状態を再確認</button
						><button
							type="button"
							onclick={() =>
								ui.send({
									type: "dlc/recover",
									requestId: crypto.randomUUID(),
								})}>保存記録から復旧</button
						>
					</div>
				</div>{/if}
			{#if ui.view.active && ui.view.active.intentId !== ui.selected?.intentId}<p
					role="status"
					class="mb-3 text-muted"
				>
					別の Intent を実行しています。異なる Worktree
					では並行して実行できます。
				</p>{/if}
			{#if ui.newIntent || ui.selected}
				{#key ui.selected?.intentId ?? "new"}
					<DlcPhases
						selected={ui.selected}
						view={ui.view}
						expanded={ui.expanded}
						onToggle={ui.toggle}
						action={ui.action}
						send={ui.send}
					>
						{#snippet initialization()}{#if ui.newIntent}<IntentForm
									send={ui.send}
									pending={ui.creation.pending}
									onSubmitted={ui.creation.submit}
								/>{:else if ui.selected}<IntentOverview
									selected={ui.selected}
									action={ui.action}
								/>{/if}{/snippet}
						{#snippet conversation()}<DlcConversation
								{bridge}
								view={ui.view}
							/>{/snippet}
					</DlcPhases>
				{/key}
			{:else}<p class="text-muted">
					左の一覧から Intent を選択してください。
				</p>{/if}
		</div>
	</div>
</main>
