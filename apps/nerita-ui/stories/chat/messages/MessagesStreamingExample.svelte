<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import Messages from "../../../src/chat/messages/Messages.svelte";
	import "../../../src/chat/chat.css";

	let message = $state.raw({
		id: "stream",
		role: "assistant" as const,
		text: "",
		streaming: false,
	});
	function setMessage(
		value: typeof message | ((current: typeof message) => typeof message),
	) {
		message = typeof value === "function" ? value(message) : value;
	}
</script>

<main class="p-[14px]">
	{#each [100, 1000] as length (length)}
		<button
			type="button"
			onclick={() =>
				setMessage({
					id: `stream-${length}`,
					role: "assistant",
					text: "あ".repeat(length),
					streaming: true,
				})}
		>
			{length}文字を受信
		</button>
	{/each}
	<button
		type="button"
		onclick={() =>
			setMessage((current) => ({
				...current,
				text: `${current.text}👨‍👩‍👧‍👦追記`,
				streaming: true,
			}))}
	>
		追記を受信
	</button>
	<button
		type="button"
		onclick={() =>
			setMessage((current) => ({ ...current, streaming: false }))}
	>
		全文を確定
	</button>
	<button
		type="button"
		onclick={() =>
			setMessage((current) => ({
				...current,
				text: "訂正 **保存済み**",
				streaming: true,
			}))}>本文を訂正</button
	>
	<Messages busy={message.streaming} messages={[message]}></Messages>
</main>
