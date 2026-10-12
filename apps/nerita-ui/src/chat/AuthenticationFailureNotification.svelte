<script lang="ts">
	// 同じ認証エラーでも次の失敗時には、新しく表示する。
	import NotificationCard from "./NotificationCard.svelte";
	let { message }: { message: string } = $props();
	let dismissed = $state(false);
</script>

{#if !dismissed}
	<NotificationCard
		onClose={() => {
			dismissed = true;
		}}
		duration={8000}
		backgroundColor="var(--nerita-input-validation-error-background)"
		children={message}
	/>
{/if}
