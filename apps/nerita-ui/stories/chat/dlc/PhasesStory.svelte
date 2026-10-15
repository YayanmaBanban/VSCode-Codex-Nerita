<!-- 実際の Phase と controller を使い、Host の初期状態だけを設定する。 -->
<script lang="ts">
	import type { DlcView } from "@nerita/shared/dlc/contracts";
	import DlcPhases from "../../../src/chat/dlc/DlcPhases.svelte";
	import IntentOverview from "../../../src/chat/dlc/IntentOverview.svelte";
	import IntentForm from "../../../src/chat/dlc/IntentForm.svelte";
	import DlcConversation from "../../../src/chat/dlc/DlcConversation.svelte";
	import { useDlcWorkspace } from "../../../src/chat/dlc/useDlcWorkspace.svelte";
	import { createWorkspaceBridge } from "./workspaceBridge";
	import "../../../src/chat/dlc/dlc.css";
	import "../../../src/chat/chat.css";

	let {
		initialView,
		expanded = [0, 1, 2, 3, 4],
	}: { initialView: DlcView; expanded?: number[] } = $props();
	const bridge = $derived(createWorkspaceBridge(initialView, expanded));
	const ui = useDlcWorkspace(() => bridge);
</script>

<main
	aria-label="DLC Phases"
	class="dlc-panel min-w-0 p-3 text-[12px]"
	data-story-dlc
	{@attach (element) => {
		Object.assign(element, { bridge });
	}}
>
	<DlcPhases
		selected={ui.selected}
		view={ui.view}
		expanded={ui.expanded}
		onToggle={ui.toggle}
		action={ui.action}
		send={ui.send}
	>
		{#snippet initialization()}
			{#if ui.selected}<IntentOverview
					selected={ui.selected}
					action={ui.action}
				/>
			{:else}<IntentForm
					send={ui.send}
					pending={ui.creation.pending}
					onSubmitted={ui.creation.submit}
				/>{/if}
		{/snippet}
		{#snippet conversation()}<DlcConversation
				{bridge}
				view={ui.view}
			/>{/snippet}
	</DlcPhases>
</main>
