<!-- 閲覧中の子スレッドを仮想化し、親の下書きと表示の開閉状態から分離する。 -->
<script lang="ts">
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import Messages from "../messages/Messages.svelte";
	import ToolCard from "../tools/ToolCard.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";
	import AgentCard from "./AgentCard.svelte";
	import AgentIcon from "./AgentIcon.svelte";
	import AgentRunControls from "./AgentRunControls.svelte";
	import { agentName } from "./agentName";
	import type { useAgentViewer } from "./useAgentViewer.svelte";
	import { messageTimeline } from "../messages/messageTimeline";
	import { useConversationVirtualizer } from "../messages/useConversationVirtualizer.svelte";
	import { useConversationWidth } from "../messages/useConversationPosition.svelte";
	import {
		useToolExpansion,
		provideToolExpansion,
	} from "../tools/ToolExpansion.svelte";

	let {
		viewer,
		state: chatState,
		send,
	}: {
		viewer: ReturnType<typeof useAgentViewer>;
		state: ChatState;
		send?: ((message: UiMessage) => void) | undefined;
	} = $props();
	let conversation: HTMLDivElement | null = $state(null);
	const following = { current: false };
	let current = $derived(
		chatState.agents.find(
			(item) => item.threadId === viewer.agent?.threadId,
		) ?? viewer.agent,
	);
	let children = $derived(
		chatState.agents.some(
			(item) => item.parentThreadId === viewer.agent?.threadId,
		)
			? chatState.agents.filter(
					(item) => item.parentThreadId === viewer.agent?.threadId,
				)
			: (viewer.view?.agents ?? []),
	);
	let timeline = $derived(
		messageTimeline(
			viewer.view?.messages ?? [],
			viewer.view?.tools ?? [],
			children,
		),
	);
	const virtual = useConversationVirtualizer(
		() => timeline,
		() => conversation,
		following,
		() => viewer.agent?.threadId ?? null,
	);
	const expansion = useToolExpansion(() => viewer.agent?.threadId ?? null);
	provideToolExpansion(expansion);
	useConversationWidth(
		() => conversation,
		virtual,
		following,
		() => viewer.agent?.threadId ?? null,
	);
</script>

{#if current}
	<section
		class="flex min-h-0 min-w-0 flex-1 flex-col"
		aria-label="サブエージェントの会話"
	>
		<header
			class="flex min-w-0 items-center gap-3 border-b border-solid border-message-border p-3"
		>
			<Tooltip content="親へ戻る">
				{#snippet children({ props })}
					<button
						{...props}
						{@attach (element: HTMLButtonElement) => {
							element.focus({ preventScroll: true });
						}}
						type="button"
						onclick={viewer.back}
						aria-label="親へ戻る"
						class="flex shrink-0 rounded p-2 hover:bg-message-user focus-visible:outline-2 focus-visible:outline-focus"
						><ArrowLeft size={18} /></button
					>
				{/snippet}
			</Tooltip>
			<AgentIcon iconKey={current.iconKey} />
			<div class="min-w-0 flex-1">
				<span class="block [overflow-wrap:anywhere]"
					>{agentName(current)}</span
				>
				<span class="text-[12px] text-muted">閲覧のみ</span>
			</div>
			<Tooltip content="表示を更新">
				{#snippet children({ props })}
					<button
						{...props}
						type="button"
						onclick={viewer.retry}
						disabled={viewer.loading}
						aria-label="会話を更新"
						class="flex shrink-0 rounded p-2 disabled:opacity-40"
						><RefreshCw size={16} /></button
					>
				{/snippet}
			</Tooltip>
		</header>
		<div
			bind:this={conversation}
			class="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto p-5 [overflow-anchor:none]"
		>
			{#if isNonEmptyString(viewer.error)}
				<div role="alert" class="mb-3 text-[12px]">
					{viewer.error}<button
						type="button"
						onclick={viewer.retry}
						class="ml-2 underline">再試行</button
					>
				</div>
			{/if}
			{#if !viewer.view && viewer.loading}
				<p role="status">会話を読み込んでいます…</p>
			{/if}
			{#if viewer.view}
				<Messages
					{timeline}
					{virtual}
					{send}
					busy={false}
					messages={viewer.view.messages}
					tools={viewer.view.tools}
				>
					{#snippet renderTool(tool)}
						<ToolCard {tool} />
					{/snippet}
					{#snippet renderAgent(child)}
						<AgentCard agent={child} onOpen={viewer.open} />
					{/snippet}
				</Messages>
				{#if viewer.view.messages.length === 0 && viewer.view.tools.length === 0 && viewer.view.agents.length === 0}
					<p class="text-[12px] text-muted">まだ会話はありません。</p>
				{/if}
			{/if}
		</div>
		{#if send}
			<AgentRunControls
				state={chatState}
				{send}
				agent={current}
				onStop={viewer.stop}
				stopping={viewer.stopping}
				stopError={viewer.stopError}
			/>
		{/if}
	</section>
{/if}
