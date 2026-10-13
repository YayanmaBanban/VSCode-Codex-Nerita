<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { virtualizationData } from "./fixtures/virtualization";
	import type { StoryBridge } from "./mocks/storyBridge";
	import { scenarioState } from "./fixtures/chatState";

	let { bridge }: { bridge: StoryBridge } = $props();
</script>

<div class="fixed top-12 right-2 z-50 flex gap-2 rounded bg-secondary p-1">
	<button
		onclick={() =>
			bridge.patchState({
				messages: [
					...virtualizationData().messages,
					{
						id: "appended",
						order: 400,
						role: "assistant",
						text: "新着の応答",
					},
				],
				run: "running",
			})}
	>
		応答を受信
	</button>
	<button
		onclick={() =>
			bridge.patchState({
				permissions: scenarioState("permission").permissions,
			})}
	>
		承認を受信
	</button>
	<button
		onclick={() => {
			const saved = [...bridge.sent]
				.reverse()
				.find((message) => message.type === "ui/saveScroll");
			if (saved?.type === "ui/saveScroll") {
				bridge.emit({
					type: "ui/viewState",
					editor: true,
					draft: "",
					restoreScroll: true,
					scrollTop: saved.scrollTop,
					...(saved.scrollAnchor
						? { scrollAnchor: saved.scrollAnchor }
						: {}),
				});
			}
		}}
	>
		復元通知を受信
	</button>
</div>
