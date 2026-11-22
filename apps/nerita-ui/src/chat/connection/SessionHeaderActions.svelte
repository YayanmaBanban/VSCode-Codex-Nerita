<!-- チャットの作成と履歴の開閉を、デスクトップとリモートで同じ操作にする。 -->
<script lang="ts">
	import { mergeProps } from "bits-ui";
	import List from "@lucide/svelte/icons/list";
	import MessageSquareText from "@lucide/svelte/icons/message-square-text";
	import Tooltip from "../../ui/Tooltip.svelte";

	let {
		available,
		canList,
		sessionsOpen,
		onNewChat,
		onToggleSessions,
		sessionPanelId = "session-panel",
	}: {
		available: boolean;
		canList: boolean;
		sessionsOpen: boolean;
		onNewChat: () => void;
		onToggleSessions: () => void;
		sessionPanelId?: string;
	} = $props();
	const iconClass =
		"chat-session-action inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover";
</script>

<Tooltip content="新しいチャット">
	{#snippet children({ props })}
		<button
			{...mergeProps(props, {
				onclick: onNewChat,
			})}
			type="button"
			class={iconClass}
			aria-label="新しいチャット"
			disabled={!available}
		>
			<MessageSquareText size={16} aria-hidden="true" />
		</button>
	{/snippet}
</Tooltip>
<Tooltip content="セッション一覧">
	{#snippet children({ props })}
		<button
			{...mergeProps(props, { onclick: onToggleSessions })}
			type="button"
			id="session-list-toggle"
			class={iconClass}
			aria-label="セッション一覧"
			disabled={!canList}
			aria-expanded={sessionsOpen}
			aria-controls={sessionPanelId}
		>
			<List size={16} aria-hidden="true" />
		</button>
	{/snippet}
</Tooltip>
