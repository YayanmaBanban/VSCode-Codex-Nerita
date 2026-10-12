<script lang="ts">
	// Pi の並列の子を閲覧しながら、個別承認と親の停止を操作する状態を再現する。
	import StoryChat from "./StoryChat.svelte";
	import { createPiAgentScenario } from "./piAgentStoryModel";
	let { background = false }: { background?: boolean } = $props();
	const bridge = $derived(createPiAgentScenario(background));
</script>

<StoryChat {bridge} />
