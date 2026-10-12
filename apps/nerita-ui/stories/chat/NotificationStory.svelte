<!-- 閉じる操作と自動消去を実コンポーネントで観察する。 -->
<script lang="ts">
	import NotificationCard from "../../src/chat/NotificationCard.svelte";
	import "../../src/chat/chat.css";
	let { backgroundColor }: { backgroundColor?: string | undefined } =
		$props();
	let open = $state(true);
</script>

<div class="pt-4">
	{#if open}<NotificationCard
			{backgroundColor}
			onClose={() => {
				open = false;
			}}
			children="フォローアップを送信しました。"
		/>{/if}
</div>
