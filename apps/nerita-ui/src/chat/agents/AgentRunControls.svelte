<!-- 閲覧中の子孫の停止と、親セッションの承認を個別に操作する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		agentSubtree,
		type SubAgentSummary,
	} from "@nerita/shared/subAgents";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import Activity from "../Activity.svelte";

	let {
		state,
		send,
		agent,
		onStop,
		stopping,
		stopError,
	}: {
		state: ChatState;
		send: (message: UiMessage) => void;
		agent: SubAgentSummary;
		onStop: () => void;
		stopping: boolean;
		stopError: string | null;
	} = $props();
	let active = $derived(
		agentSubtree(
			[
				agent,
				...state.agents.filter(
					(item) => item.threadId !== agent.threadId,
				),
			],
			agent.threadId,
		).some((item) =>
			["running", "pendingInit", "idle"].includes(item.status),
		),
	);
	let inactive = $derived(!active && !stopping && stopError === null);
</script>

{#if !inactive || state.permissions.length > 0}
	<aside
		aria-label="エージェントの停止・承認"
		class="max-h-[45%] shrink-0 overflow-y-auto border-t border-solid border-message-border p-3 text-[12px]"
	>
		<div class="mb-2 flex justify-end">
			<button
				type="button"
				disabled={!active || stopping}
				class="rounded border border-solid border-message-border px-3 py-2 hover:bg-message-user disabled:opacity-40"
				onclick={onStop}
				>{stopping ? "停止要求中…" : "自身と子を停止"}</button
			>
		</div>
		{#if isNonEmptyString(stopError)}
			<p role="alert" class="text-tool-error">
				{stopError}
			</p>
		{/if}
		{#if state.permissions.length > 0}
			<p>セッション全体の承認</p>
			<Activity state={{ ...state, tools: [] }} {send} />
		{/if}
	</aside>
{/if}
