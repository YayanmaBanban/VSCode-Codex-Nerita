<script lang="ts">
	// Host の初期応答だけをモックし、以後の操作は検証側が明示的に応答する。
	import type { UiMessage } from "@nerita/shared/messages";
	import DlcWorkspace from "../../../src/chat/dlc/DlcWorkspace.svelte";
	import { createStoryBridge } from "../mocks/storyBridge";
	import { scenarioState } from "../fixtures/chatState";
	import { first, second, view } from "./workspaceState";
	import StoryChat from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";

	let { chatModes = false }: { chatModes?: boolean } = $props();
	const chatBridge = createChatStoryBridge("empty");
	const mock = createStoryBridge(scenarioState("empty"));
	let initialized = false;
	const bridge = {
		...mock,
		postMessage(message: UiMessage) {
			mock.postMessage(message);
			if (message.type === "ui/ready" && !initialized) {
				initialized = true;
				mock.emit({
					type: "dlc/editorState",
					state: { expanded: { [first]: [0], [second]: [0] } },
				});
				mock.emit({ type: "dlc/state", view: view() });
			}
		},
	};
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
