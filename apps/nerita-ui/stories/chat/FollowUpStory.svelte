<script lang="ts">
	// 同じ入力欄で、受付待ち・失敗・再送を観察する。
	import StoryChat from "./StoryChat.svelte";
	import { createFollowUpScenario } from "./followUpStoryModel";
	let {
		failFirst = false,
		completed = false,
	}: { failFirst?: boolean; completed?: boolean } = $props();
	const bridge = $derived(createFollowUpScenario(failFirst, completed));
</script>

<StoryChat {bridge} />
