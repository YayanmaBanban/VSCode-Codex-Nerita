<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import StoryChat from "./StoryChat.svelte";
	import { createChatStoryBridge } from "./mocks/mockBridge";
	import { virtualizationData } from "./fixtures/virtualization";
	import UpdateControls from "./VirtualizationUpdateControls.svelte";

	let { updates = false }: { updates?: boolean } = $props();
	const bridge = (() => {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			...virtualizationData(),
			sessionId: "virtual-session",
		});
		return mock;
	})();
</script>

{#if updates}<UpdateControls {bridge}></UpdateControls>{/if}
<StoryChat {bridge}></StoryChat>
