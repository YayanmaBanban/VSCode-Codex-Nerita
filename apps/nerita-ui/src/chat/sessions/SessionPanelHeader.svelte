<!-- 履歴パネルの閉じる操作と作業フォルダ・取得状態を表示する。 -->
<script lang="ts">
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import X from "@lucide/svelte/icons/x";
	import { mergeProps } from "bits-ui";
	import type { ChatState } from "@nerita/shared/chatState";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { sessionActionClass } from "./sessionStyles";

	let {
		state,
		close = $bindable(),
		onClose,
	}: {
		state: Pick<ChatState, "cwd" | "sessionsLoading">;
		close?: HTMLButtonElement | undefined;
		onClose: () => void;
	} = $props();
</script>

<header
	class="border-0 border-b border-solid border-panel-border px-[16px] py-[14px]"
>
	<div class="flex items-center justify-between gap-[8px]">
		<h2 class="m-0 text-[13px] font-semibold">セッション一覧</h2>
		<Tooltip content="閉じる">
			{#snippet children({ props })}
				<button
					{...mergeProps(props, { onclick: onClose })}
					bind:this={close}
					type="button"
					class={sessionActionClass}
					aria-label="セッション一覧を閉じる"
				>
					<X size={16} aria-hidden="true" />
				</button>
			{/snippet}
		</Tooltip>
	</div>
	<div class="mt-[8px] flex items-start gap-[8px]">
		<Tooltip content={state.cwd ?? undefined}>
			{#snippet children({ props: tooltipProps })}
				<span
					{...tooltipProps}
					tabindex="-1"
					class="min-w-0 flex-1 font-editor text-[12px] leading-[1.6] break-all text-muted"
					>{state.cwd ?? "ワークスペース未接続"}</span
				>
			{/snippet}
		</Tooltip>
		{#if state.sessionsLoading}
			<span
				role="progressbar"
				aria-label="セッション一覧を取得中"
				class="mt-[1px] inline-flex shrink-0 text-link"
				><LoaderCircle
					size={15}
					class="motion-safe:animate-spin"
					aria-hidden="true"
				/></span
			>
		{/if}
	</div>
</header>
