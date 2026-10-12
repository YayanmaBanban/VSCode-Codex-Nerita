<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import StoryChat from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";
	import { messages } from "./HistoryRenderingData";
	const bridge = (() => {
		const bridge = createChatStoryBridge();
		bridge.patchState({ messages });
		return bridge;
	})();
</script>

<StoryChat {bridge}></StoryChat>
