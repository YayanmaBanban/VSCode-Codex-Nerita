<!-- 会話・承認・進行状態を1つのスクロール領域に配置する。 -->
<script lang="ts">
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { SubAgentSummary } from "@nerita/shared/subAgents";
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import { mergeProps } from "bits-ui";
	import SettingsTooltip from "./SettingsTooltip.svelte";
	import Activity from "./Activity.svelte";
	import AgentCard from "./agents/AgentCard.svelte";
	import Messages from "./messages/Messages.svelte";
	import PlanDecisionCard from "./PlanDecisionCard.svelte";
	import RunStatusIcon from "./RunStatusIcon.svelte";
	import ThinkingIndicator from "./ThinkingIndicator.svelte";
	import type { MessageTimeline } from "./messages/messageTimeline";
	import type { ConversationVirtualizer } from "./messages/useConversationVirtualizer.svelte";
	import { messageIconButtonClass } from "./messages/messageStyles";

	let {
		state: chatState,
		busy,
		send,
		conversation = $bindable(null),
		bottom = $bindable(null),
		onOpenAgent,
		timeline,
		virtual,
	}: {
		state: ChatState;
		busy: boolean;
		send: (message: UiMessage) => void;
		conversation?: HTMLElement | null;
		bottom?: HTMLDivElement | null;
		onOpenAgent: (agent: SubAgentSummary) => void;
		timeline: MessageTimeline;
		virtual: ConversationVirtualizer;
	} = $props();
	let awayFromBottom = $state(false);
	const runLabels = {
		idle: "",
		running: "",
		cancelling: "停止しています…",
		completed: "",
		cancelled: "停止しました",
		failed: "実行に失敗しました",
	};
	/** 会話 DOM のサイズとスクロールに末尾ボタンを同期する。 */
	function observeConversationBottom() {
		void chatState.sessionId;
		const element = conversation;
		if (!element) {
			return;
		}
		const update = () => {
			awayFromBottom =
				element.clientHeight > 0 &&
				element.scrollHeight -
					element.clientHeight -
					element.scrollTop >
					4;
		};
		const resize = new ResizeObserver(update);
		resize.observe(element);
		element.addEventListener("scroll", update);
		update();
		return () => {
			resize.disconnect();
			element.removeEventListener("scroll", update);
		};
	}
	// 会話 DOM の交換時にサイズとスクロールの監視を張り替え、末尾ボタンの表示を更新する。
	$effect(observeConversationBottom);
	/** 末尾移動後は会話へフォーカスを戻し、スクロール追従を再開する。 */
	function toBottom() {
		conversation?.scrollTo({
			top: conversation.scrollHeight,
			behavior: "instant",
		});
		conversation?.focus({ preventScroll: true });
		awayFromBottom = false;
	}
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
	<section
		bind:this={conversation}
		class="conversation min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-[20px] py-[22px] [overflow-anchor:none]"
		aria-label="会話"
		tabindex="-1"
	>
		{#if chatState.messages.length === 0}<div
				class="empty-state px-0 pt-[10vh] pb-[30px] text-center"
			>
				<p class="text-[12px] text-muted">
					このワークスペースで作業します
				</p>
				<p
					class="text-[12px] leading-[1.7] [overflow-wrap:anywhere] text-muted"
				>
					{chatState.cwd}
				</p>
			</div>{/if}
		<div
			role="log"
			aria-label="メッセージ"
			aria-live="polite"
			aria-relevant="additions text"
		>
			<Messages
				{timeline}
				{virtual}
				{send}
				messages={chatState.messages}
				{busy}
				tools={chatState.tools}
				agents={chatState.agents.filter(
					(agent) => agent.parentThreadId === chatState.sessionId,
				)}
			>
				{#snippet renderAgent(agent)}<AgentCard
						{agent}
						onOpen={onOpenAgent}
					/>{/snippet}
				{#snippet renderTool(tool)}<Activity
						state={{ ...chatState, tools: [tool], permissions: [] }}
						{send}
					/>{/snippet}
			</Messages>
		</div>
		<Activity state={{ ...chatState, tools: [] }} {send} />
		<PlanDecisionCard state={chatState} {send} />
		{#if chatState.run === "running"}<ThinkingIndicator />{/if}
		{#if runLabels[chatState.run] !== ""}<p
				class="run-status my-2 flex items-center gap-1 text-[12px] text-muted"
				role="status"
			>
				{runLabels[chatState.run]}<RunStatusIcon
					kind={chatState.run === "failed" ? "startled" : "loaf"}
				/>
			</p>{/if}
		<div bind:this={bottom}></div>
	</section>
	{#if awayFromBottom}<div
			class="absolute bottom-3 left-1/2 z-10 -translate-x-1/2"
		>
			<SettingsTooltip content="メッセージの末尾へ移動"
				>{#snippet children({ props })}<button
						{...mergeProps(props, { onclick: toBottom })}
						type="button"
						aria-label="メッセージの末尾へ移動"
						class={`${messageIconButtonClass} size-9 rounded-full border border-solid border-panel-border bg-secondary hover:bg-settings-hover`}
						><ArrowDown size={18} aria-hidden="true" /></button
					>{/snippet}</SettingsTooltip
			>
		</div>{/if}
</div>
