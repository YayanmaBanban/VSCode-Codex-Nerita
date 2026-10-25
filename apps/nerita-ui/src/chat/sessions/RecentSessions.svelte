<!-- 空の会話から最近のセッションを復元し、履歴一覧へ移動する。 -->
<script lang="ts">
	import { onMount } from "svelte";
	import History from "@lucide/svelte/icons/history";
	import { mergeProps } from "bits-ui";
	import { cn } from "cnfast";
	import { taskActive } from "@nerita/shared/asyncTask";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { relativeTime } from "./relativeTime";

	let {
		state: chatState,
		send,
		available,
		sessionsOpen,
		onOpen,
	}: {
		state: ChatState;
		send: (message: UiMessage) => void;
		available: boolean;
		sessionsOpen: boolean;
		onOpen: () => void;
	} = $props();
	let now = $state(Date.now());
	const sessions = $derived(
		chatState.sessions
			.filter(
				(session) =>
					!chatState.sessionsArchived && session.archived !== true,
			)
			.sort(
				(left, right) =>
					updatedTime(right.updatedAt) - updatedTime(left.updatedAt),
			)
			.slice(0, 3),
	);
	const disabled = $derived(
		!available ||
			!chatState.sessionCapabilities.load ||
			chatState.asyncTasks.some(taskActive),
	);
	/** 更新日時が未指定・不正な履歴を後ろに並べるため、時刻を0として扱う。 */
	function updatedTime(value: string | undefined) {
		const timestamp = Date.parse(value ?? "");
		return Number.isFinite(timestamp) ? timestamp : 0;
	}
	onMount(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 30000);
		return () => clearInterval(timer);
	});
</script>

<section
	class="mx-auto w-full max-w-[600px] pb-[30px]"
	aria-label="最近のスレッド"
>
	{#if sessions.length > 0}
		<h2 class="m-0 px-[10px] pb-[8px] text-[12px] font-normal text-muted">
			最近のスレッド
		</h2>
		<ul class="m-0 list-none p-0">
			{#each sessions as session (session.sessionId)}
				{@const title =
					nonEmptyString(session.title?.trim()) ?? "無題のセッション"}
				<li>
					<Tooltip content={title}>
						{#snippet children({ props })}
							<button
								{...mergeProps(props, {
									onclick: () =>
										send({
											type: "session/load",
											requestId: crypto.randomUUID(),
											sessionId: session.sessionId,
										}),
								})}
								type="button"
								class={cn(
									"flex w-full items-center gap-[12px] rounded-[6px] border-0 bg-transparent px-[10px] py-[12px] text-left text-[13px] text-primary-text",
									"hover:bg-menu-hover focus-visible:outline-focus disabled:opacity-50",
								)}
								{disabled}
								aria-label={`「${title}」を開く`}
							>
								<span class="min-w-0 flex-1 truncate"
									>{title}</span
								>
								<span class="shrink-0 text-[12px] text-muted"
									>{relativeTime(
										session.updatedAt,
										now,
									)}</span
								>
							</button>
						{/snippet}
					</Tooltip>
				</li>
			{/each}
		</ul>
	{/if}
	<button
		type="button"
		class={cn(
			"mt-[12px] flex w-full items-center justify-center gap-[8px] rounded-[6px] border border-solid border-panel-border bg-transparent px-[12px] py-[10px] text-[13px] text-primary-text",
			"hover:bg-menu-hover focus-visible:outline-focus disabled:opacity-50",
		)}
		onclick={onOpen}
		aria-label="セッション一覧を開く"
		disabled={chatState.connection !== "ready"}
		aria-controls="session-panel"
		aria-expanded={sessionsOpen}
		><History
			size={16}
			class="text-muted"
			aria-hidden="true"
		/>セッション一覧</button
	>
</section>
