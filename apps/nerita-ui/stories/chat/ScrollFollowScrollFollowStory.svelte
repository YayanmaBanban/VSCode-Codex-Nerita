<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ChatApp from "./StoryChat.svelte";
	import { createScrollControl } from "./ScrollFollowData";

	const control = createScrollControl();
</script>

<div class="fixed top-0 right-0 z-50">
	<button onclick={() => control.append()}>本文を追記</button>
	<button onclick={() => control.tool()}>ツールを追加</button>
	<button onclick={() => control.reset()}>会話を切替</button>
</div>
<ChatApp bridge={control.bridge}></ChatApp>
