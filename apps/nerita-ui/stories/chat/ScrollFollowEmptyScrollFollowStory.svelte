<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ChatApp from "./StoryChat.svelte";
	import { createEmptyScrollControl } from "./ScrollFollowData";

	const control = createEmptyScrollControl();
</script>

<div class="fixed top-0 right-0 z-50">
	<button onclick={() => control.accept()}> 送信を受け付ける </button>
	<button onclick={() => control.tool()}>カードを受信</button>
	<button
		onclick={() => {
			for (let index = 0; index < 20; index++) {
				control.tool();
			}
		}}
	>
		カードをまとめて受信
	</button> <button onclick={() => control.answer()}>回答を受信</button>
</div>
<ChatApp bridge={control.bridge}></ChatApp>
