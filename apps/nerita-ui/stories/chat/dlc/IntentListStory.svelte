<script lang="ts">
	// 実コントローラーの購読後に初期状態を配信し、操作への応答は自動生成しない。
	import { onMount } from "svelte";
	import type { DlcView } from "@nerita/shared/dlc/contracts";
	import DlcIntentList from "../../../src/chat/dlc/DlcIntentList.svelte";
	import { useDlcWorkspace } from "../../../src/chat/dlc/useDlcWorkspace.svelte";
	import { scenarioState } from "../fixtures/chatState";
	import { createStoryBridge } from "../mocks/storyBridge";
	import "../../../src/chat/chat.css";
	let { view }: { view: DlcView } = $props();
	const bridge = createStoryBridge(scenarioState("empty"));
	const ui = useDlcWorkspace(bridge);
	onMount(() => {
		bridge.emit({ type: "dlc/state", view });
	});
</script>

<div
	class="grid h-screen max-w-[360px] grid-cols-1"
	data-story-intent-list
	{@attach (element) => {
		Object.assign(element, { bridge });
	}}
>
	<DlcIntentList {ui} />
</div>
