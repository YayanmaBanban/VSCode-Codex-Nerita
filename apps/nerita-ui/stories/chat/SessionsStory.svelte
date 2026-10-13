<!-- マウントごとに独立した履歴と通信を実チャットへ渡す。 -->
<script lang="ts">
	import StoryChat from "./StoryChat.svelte";
	import {
		createSessionBridge,
		type SessionScenario,
	} from "./mocks/mockSessionBridge";

	let { scenario }: { scenario: SessionScenario } = $props();
	const bridge = $derived(createSessionBridge(scenario));
</script>

<StoryChat {bridge} />
