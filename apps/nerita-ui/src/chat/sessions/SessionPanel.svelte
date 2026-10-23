<!-- 作業フォルダと履歴を右ペインに表示し、閉じる途中の操作を防ぐ。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { onMount } from "svelte";
	import { prefersReducedMotion } from "svelte/motion";
	import { cubicBezier } from "motion";
	import type { TransitionConfig } from "svelte/transition";
	import Archive from "@lucide/svelte/icons/archive";
	import List from "@lucide/svelte/icons/list";
	import { taskActive } from "@nerita/shared/asyncTask";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import SessionItem from "./SessionItem.svelte";
	import SessionPanelHeader from "./SessionPanelHeader.svelte";

	let {
		state: chatState,
		send,
		onClose,
		compact,
	}: {
		state: ChatState;
		send: (message: UiMessage) => void;
		onClose: () => void;
		compact: boolean;
	} = $props();
	let now = $state(Date.now());
	let close = $state<HTMLButtonElement>();
	let exiting = $state(false);
	const panelEasing = cubicBezier(0.22, 1, 0.36, 1);
	const capabilities = $derived(chatState.sessionCapabilities);
	const connectionPending = $derived(
		chatState.connection !== "ready" ||
			chatState.sessionPending ||
			chatState.configPending,
	);
	const runPending = $derived(
		chatState.attachmentPending ||
			chatState.run === "running" ||
			chatState.run === "cancelling",
	);
	const disabled = $derived(
		connectionPending ||
			runPending ||
			chatState.asyncTasks.some(taskActive),
	);
	onMount(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 30000);
		return () => clearInterval(timer);
	});
	/** 内容の幅を保ち、広い画面では表示枠の幅、狭い画面では位置を変えて横スクロールを防ぐ。 */
	function pane(node: HTMLElement): TransitionConfig {
		const width = node.getBoundingClientRect().width;
		return {
			duration: prefersReducedMotion.current ? 0 : 220,
			easing: panelEasing,
			css: (t) =>
				`width:${compact ? width : t * width}px;--session-panel-width:${width}px;--session-panel-offset:${compact ? (1 - t) * 100 : 0}%`,
		};
	}
	/** IME の変換中とダイアログからの Escape を履歴の閉じる操作と混同しない。 */
	function keydown(event: KeyboardEvent) {
		if (event.key === "Escape" && !event.isComposing) {
			event.stopPropagation();
			onClose();
		}
	}
</script>

<aside
	transition:pane|global
	onoutrostart={() => {
		exiting = true;
	}}
	onintrostart={() => {
		exiting = false;
	}}
	onintroend={() => {
		// 移動中のボタンへの自動スクロールと、ツールチップの位置ずれを避ける。
		close?.focus({ preventScroll: true });
	}}
	inert={exiting}
	aria-hidden={exiting}
	id="session-panel"
	aria-label="セッション一覧"
	class={cn(
		"absolute inset-y-0 right-0 z-20 w-[350px] max-w-full shrink-0 overflow-hidden text-menu-text",
		"drop-shadow-[-8px_0_12px_#0002]",
		"[@media(min-width:760px)]:static [@media(min-width:760px)]:drop-shadow-none",
	)}
	onkeydown={keydown}
>
	<div
		class={cn(
			"flex h-full w-[350px] max-w-[var(--session-panel-width,100%)]",
			"[transform:translateX(var(--session-panel-offset,0%))]",
			"flex-col border-0 border-l border-solid border-panel-border bg-menu",
		)}
	>
		<SessionPanelHeader state={chatState} bind:close {onClose} />
		{#if capabilities.unarchive === true}
			<div
				class="flex gap-[8px] px-[12px] py-[8px]"
				role="group"
				aria-label="履歴の表示範囲"
			>
				{#each [false, true] as archived (archived)}
					<button
						type="button"
						class={cn(
							"inline-flex items-center gap-[6px] text-[12px]",
							"aria-pressed:border-focus aria-pressed:font-semibold aria-pressed:underline",
							"aria-pressed:underline-offset-4",
						)}
						aria-pressed={chatState.sessionsArchived === archived}
						disabled={chatState.sessionPending ||
							chatState.connection !== "ready"}
						onclick={() =>
							send({
								type: "session/list",
								archived,
								requestId: crypto.randomUUID(),
							})}
						>{#if archived}<Archive
								size={14}
								aria-hidden="true"
							/>{:else}<List
								size={14}
								aria-hidden="true"
							/>{/if}{archived ? "アーカイブ" : "履歴"}</button
					>
				{/each}
			</div>
		{/if}
		<div
			class="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto p-[8px]"
		>
			{#if isNonEmptyString(chatState.sessionsError)}
				<div
					role="alert"
					class="m-[4px] rounded-[6px] border border-solid border-alert-border bg-alert p-[10px] text-[12px] leading-[1.7]"
				>
					{chatState.sessionsError}{#if capabilities.list}<button
							type="button"
							class="mt-[8px] block text-[12px]"
							disabled={chatState.sessionsLoading ||
								chatState.sessionPending}
							onclick={() =>
								send({
									type: "session/list",
									requestId: crypto.randomUUID(),
								})}>再試行</button
						>{/if}
				</div>
			{/if}
			{#if chatState.sessionPending}
				<p role="status" class="mx-[8px] text-[12px] text-muted">
					セッションを更新しています…
				</p>
			{/if}
			{#if chatState.sessions.length === 0 && !chatState.sessionsLoading && !isNonEmptyString(chatState.sessionsError)}
				<p
					class="px-[12px] py-[24px] text-center text-[12px] text-muted"
				>
					このフォルダのセッションはありません
				</p>
			{/if}
			<ul class="m-0 list-none p-0" aria-label="セッション履歴">
				{#each chatState.sessions as session (session.sessionId)}
					<SessionItem
						{session}
						selected={session.sessionId === chatState.sessionId}
						{capabilities}
						{send}
						{now}
						{disabled}
					/>
				{/each}
			</ul>
			{#if chatState.sessionsNextCursor !== null}
				<button
					type="button"
					class="mx-[12px] my-[8px] text-[12px]"
					disabled={chatState.sessionsLoading ||
						chatState.sessionPending}
					onclick={() =>
						send({
							type: "session/list",
							more: true,
							requestId: crypto.randomUUID(),
						})}>さらに読み込む</button
				>
			{/if}
		</div>
	</div>
</aside>
