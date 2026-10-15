<script lang="ts">
	// Host の初期応答だけをモックし、以後の操作は検証側が明示的に応答する。
	import type { DlcView } from "@nerita/shared/dlc/contracts";
	import DlcWorkspace from "../../../src/chat/dlc/DlcWorkspace.svelte";
	import { view } from "./workspaceState";
	import { createWorkspaceBridge } from "./workspaceBridge";
	import StoryChat from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";

	let {
		chatModes = false,
		initialView = view(),
		expanded = [0],
	}: {
		chatModes?: boolean;
		initialView?: DlcView;
		expanded?: number[];
	} = $props();
	const chatBridge = createChatStoryBridge("empty");
	const bridge = $derived(createWorkspaceBridge(initialView, expanded));
</script>

{#if chatModes}
	<StoryChat bridge={chatBridge} />
{:else}
	<div
		data-story-dlc
		{@attach (element) => {
			Object.assign(element, { bridge });
		}}
	>
		<DlcWorkspace {bridge} />
	</div>
{/if}
