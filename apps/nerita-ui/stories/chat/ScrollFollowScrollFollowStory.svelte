<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ChatApp from "./StoryChat.svelte";
	import { createScrollControl } from "./ScrollFollowData";

	const control = createScrollControl();
	let streaming = $state(false);
	/** 複数の配信操作が混ざらないよう、受信中は開始ボタンを無効にする。 */
	async function stream() {
		streaming = true;
		try {
			await control.stream();
		} finally {
			streaming = false;
		}
	}
</script>

<div class="fixed top-0 right-0 z-50">
	<button onclick={() => control.append()}>本文を追記</button>
	<button onclick={() => control.tool()}>ツールを追加</button>
	<button onclick={() => control.reset()}>会話を切替</button>
	<button onclick={stream} disabled={streaming}>マークダウンを受信</button>
</div>
<ChatApp bridge={control.bridge}></ChatApp>
