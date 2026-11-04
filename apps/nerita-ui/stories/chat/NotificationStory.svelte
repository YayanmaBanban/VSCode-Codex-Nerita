<!-- 閉じる操作と自動消去を実コンポーネントで観察する。 -->
<script lang="ts">
	import NotificationCard from "../../src/chat/NotificationCard.svelte";
	import "../../src/chat/chat.css";

	let {
		backgroundColor,
		duration = 2000,
	}: {
		backgroundColor?: string | undefined;
		duration?: number;
	} = $props();
	let open = $state(true);
	let generation = $state(0);
</script>

<div class="pt-4">
	<button
		type="button"
		class="text-primary-text"
		onclick={() => {
			open = true;
			generation++;
		}}
	>
		通知を再生
	</button>
	{#key generation}
		{#if open}
			<NotificationCard
				{backgroundColor}
				{duration}
				onClose={() => {
					open = false;
				}}
				children="フォローアップを送信しました。"
			/>
		{/if}
	{/key}
</div>
