<script lang="ts">
	// 本体と同じ描画経路に、独立した通信シナリオを注入する。
	import StoryChat from "./StoryChat.svelte";
	import { createChatScenario, type ChatStoryProps } from "./chatStoryModel";

	let props: ChatStoryProps = $props();
	const bridge = $derived(createChatScenario(props));
</script>

<StoryChat {bridge} />
