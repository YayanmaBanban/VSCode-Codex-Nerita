<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import Messages from "../../../src/chat/messages/Messages.svelte";
	import "../../../src/chat/chat.css";
</script>

<main class="p-[14px]">
	<Messages
		busy={false}
		messages={[
			{
				id: "user",
				role: "user",
				text: "素材の一覧を確認してください。",
			},
			{
				id: "answer",
				role: "assistant",
				text: "**必要な素材**\n\n- 作戦記録: 75\n- 折金券: 510K",
			},
		]}
	></Messages>
</main>
