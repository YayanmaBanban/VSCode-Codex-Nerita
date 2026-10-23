<!-- 会話・検索・子エージェント・入力を、通常チャットと DLC の埋め込み表示で共用する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import type { ChatState } from "@nerita/shared/chatState";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ChatWorkspaceHeader } from "./chatWorkspaceModel";
	import { messageTimeline } from "./messages/messageTimeline";
	import { useConversationVirtualizer } from "./messages/useConversationVirtualizer.svelte";
	import { useConversationPosition } from "./messages/useConversationPosition.svelte";
	import { useFollowConversation } from "./messages/useFollowConversation.svelte";
	import ToolExpansionProvider from "./tools/ToolExpansionProvider.svelte";
	import { useToolExpansion } from "./tools/ToolExpansion.svelte";
	import AgentViewer from "./agents/AgentViewer.svelte";
	import { useAgentViewer } from "./agents/useAgentViewer.svelte";
	import ChatConversation from "./ChatConversation.svelte";
	import ChatComposer from "./composer/ChatComposer.svelte";
	import ChatSearchBar from "./search/ChatSearchBar.svelte";
	import { useChatSearch } from "./search/useChatSearch.svelte";
	import SessionPanel from "./sessions/SessionPanel.svelte";
	import { useSessionPanel } from "./sessions/useSessionPanel.svelte";
	import AuthenticationFailureNotification from "./AuthenticationFailureNotification.svelte";
	import { useChat } from "./useChat.svelte";
	import { useChatView } from "./useChatView.svelte";
	import "./chat.css";
	import "./dlc/dlc.css";

	let {
		bridge,
		managed = false,
		header,
	}: {
		bridge: Bridge;
		managed?: boolean;
		header?: Snippet<[ChatWorkspaceHeader]>;
	} = $props();
	const view = useChatView(() => bridge);
	const chat = useChat(() => bridge);
	const sessionId = $derived(chat.state.sessionId);
	const messages = $derived(chat.state.messages);
	const tools = $derived(chat.state.tools);
	const agents = $derived(chat.state.agents);
	const agentViewer = useAgentViewer(
		() => bridge,
		() => sessionId,
		chat.send,
	);
	const timeline = $derived(
		messageTimeline(
			messages,
			tools,
			agents.filter((agent) => agent.parentThreadId === sessionId),
		),
	);
	const following = $state({ current: true });
	const virtual = useConversationVirtualizer(
		() => timeline,
		() => view.conversation,
		following,
		() => sessionId,
	);
	const expansion = useToolExpansion(() => sessionId);
	useConversationPosition(view, virtual, () => sessionId, following);
	const search = useChatSearch(
		() => view.conversation,
		() => timeline,
		virtual,
		expansion,
	);
	const sessionPanel = useSessionPanel(chat.send);
	let submissionLocked = $state(false);
	const busy = $derived(
		chat.state.run === "running" || chat.state.run === "cancelling",
	);
	const available = $derived(
		chatAvailable(chat.state, busy, submissionLocked),
	);
	const sessionsVisible = $derived(sessionPanel.open && !managed);
	useFollowConversation(
		() => view.conversation,
		() => sessionId,
		() => search.open || agentViewer.agent !== undefined,
		following,
	);
	/** 入力フォームの保留中は、設定と会話切り替えを一時的に止める。 */
	function onSubmissionLock(locked: boolean) {
		submissionLocked = locked;
	}
	/** 会話のスクロール位置を管理するこの画面で、末尾への追従を再開する。 */
	function resumeFollowing() {
		following.current = true;
	}
	/** 実行と設定の待機中は会話操作を無効にする。 */
	function chatAvailable(host: ChatState, running: boolean, locked: boolean) {
		const ready = host.connection === "ready" && !running && !locked;
		if (!ready) {
			return false;
		}
		return (
			!host.sessionPending &&
			!host.configPending &&
			!host.attachmentPending
		);
	}
</script>

<ToolExpansionProvider {expansion} {bridge}>
	<div class="chat-app flex h-full min-h-0 min-w-0 flex-col">
		{@render header?.({ view, chat, available, sessionPanel })}
		<div class="relative flex min-h-0 flex-1 overflow-x-clip">
			{#if agentViewer.agent}
				<AgentViewer
					viewer={agentViewer}
					state={chat.state}
					send={chat.send}
				/>
			{/if}
			<div
				class={agentViewer.agent
					? "hidden"
					: "flex min-w-0 flex-1 flex-col"}
				inert={sessionsVisible && sessionPanel.compact}
			>
				<ChatSearchBar {search} />
				<ChatConversation
					state={chat.state}
					send={chat.send}
					{busy}
					{timeline}
					{virtual}
					{following}
					bind:conversation={view.conversation}
					bind:bottom={view.bottom}
					onOpenAgent={agentViewer.open}
					onResumeFollowing={resumeFollowing}
				/>
				{#if chat.state.connection === "auth-required" && isNonEmptyString(chat.state.error)}
					{#key chat.state.error}
						<AuthenticationFailureNotification
							message={chat.state.error}
						/>
					{/key}
				{/if}
				<ChatComposer
					{bridge}
					state={chat.state}
					send={chat.send}
					{busy}
					visible={!managed}
					onLockChange={onSubmissionLock}
				/>
			</div>
			{#if sessionsVisible}
				<SessionPanel
					compact={sessionPanel.compact}
					state={chat.state}
					send={chat.send}
					onClose={sessionPanel.close}
				/>
			{/if}
		</div>
	</div>
</ToolExpansionProvider>
