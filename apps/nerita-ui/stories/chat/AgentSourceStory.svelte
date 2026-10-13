<script lang="ts">
	// Bridge とセッションの切替後に、旧応答と旧購読が残らないことを検証する。
	import { onMount } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { HostMessage } from "@nerita/shared/messages";
	import { useAgentViewer } from "../../src/chat/agents/useAgentViewer.svelte";
	import { useDlc } from "../../src/chat/dlc/useDlc.svelte";
	import { createStoryBridge } from "./mocks/storyBridge";
	import { scenarioState } from "./fixtures/chatState";
	import { child } from "./agentStoryState";
	import {
		view,
		projection,
		first as firstIntent,
	} from "./dlc/workspaceState";

	function source() {
		const mock = createStoryBridge(scenarioState("empty"));
		const listeners = new SvelteSet<Parameters<typeof mock.subscribe>[0]>();
		const captured: Parameters<typeof mock.subscribe>[0][] = [];
		return {
			...mock,
			get listenerCount() {
				return listeners.size;
			},
			subscribe(listener: Parameters<typeof mock.subscribe>[0]) {
				listeners.add(listener);
				captured.push(listener);
				const unsubscribe = mock.subscribe(listener);
				return () => {
					listeners.delete(listener);
					unsubscribe();
				};
			},
			deliverCaptured(message: HostMessage) {
				for (const listener of captured) {
					listener(message);
				}
			},
		};
	}
	const first = source();
	const second = source();
	let bridge = $state.raw(first);
	let sessionId = $state<string | null>("first-session");
	const viewer = useAgentViewer(
		() => bridge,
		() => sessionId,
		(message) => bridge.postMessage(message),
	);
	const dlc = useDlc(() => bridge);
	onMount(() =>
		first.emit({
			type: "dlc/state",
			view: view(projection(firstIntent, "最初の接続")),
		}),
	);
	function switchSource() {
		bridge = second;
		sessionId = "second-session";
	}
	function attachSources(element: HTMLElement) {
		Object.assign(element, { first, second });
	}
</script>

<main
	data-story-sources
	{@attach attachSources}
	class="flex flex-col gap-3 p-5"
>
	<button type="button" onclick={() => viewer.open(child)}
		>子の会話を開く</button
	>
	<button type="button" onclick={switchSource}>接続を切り替え</button>
	<p>Intent: {dlc.view.selected?.title ?? "未選択"}</p>
	<p>閲覧: {viewer.agent?.threadId ?? "親"}</p>
	{#if viewer.view}<p>{viewer.view.messages[0]?.text}</p>{/if}
</main>
