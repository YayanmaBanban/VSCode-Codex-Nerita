<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { searchMessages } from "./fixtures/search";
	import ChatApp from "./StoryChat.svelte";
	import { createChatStoryBridge } from "./mocks/mockBridge";

	const bridge = (() => {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			messages: searchMessages(),
		});
		return mock;
	})();
</script>

<ChatApp {bridge}></ChatApp>
