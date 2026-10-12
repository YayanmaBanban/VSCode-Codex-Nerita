<!-- 永久削除の前に取り消せないことを説明し、確認後だけ要求を送る。 -->
<script lang="ts">
	import { AlertDialog } from "bits-ui";
	import Trash from "@lucide/svelte/icons/trash";
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { SessionSummary } from "@nerita/shared/sessionHistory";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	let {
		session,
		disabled,
		send,
	}: {
		session: SessionSummary;
		disabled: boolean;
		send: (message: UiMessage) => void;
	} = $props();
	let open = $state(false);
	const title = $derived(
		nonEmptyString(session.title?.trim()) ?? "無題のセッション",
	);
	/** 確認だけを閉じ、背後の履歴パネルへ Escape を届けない。 */
	function dialogKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === "Escape" && !event.isComposing) {
			open = false;
		}
	}
</script>

<AlertDialog.Root bind:open>
	<SettingsTooltip content="セッションを削除"
		>{#snippet children({ props })}
			<AlertDialog.Trigger
				{...props}
				{disabled}
				aria-label={`${title}を削除`}
				class="inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-red-500 hover:bg-red-500/10 focus-visible:outline-offset-[-2px]"
				><Trash size={14} aria-hidden="true" /></AlertDialog.Trigger
			>
		{/snippet}</SettingsTooltip
	>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
		<AlertDialog.Content
			class="fixed top-1/2 left-1/2 z-50 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-solid border-menu-border bg-menu p-[20px] text-menu-text shadow-[0_8px_32px_#0004]"
			onkeydown={dialogKeydown}
		>
			<AlertDialog.Title class="m-0 text-[14px] font-semibold"
				>セッションを削除しますか？</AlertDialog.Title
			>
			<AlertDialog.Description
				class="my-[14px] text-[12px] leading-[1.7] [overflow-wrap:anywhere]"
				>「{title}」を削除します。この操作は取り消せません。</AlertDialog.Description
			>
			<div class="flex flex-wrap justify-end gap-[8px]">
				<AlertDialog.Cancel
					class="rounded-[6px] px-[12px] py-[8px] text-[12px]"
					>キャンセル</AlertDialog.Cancel
				>
				<AlertDialog.Action
					{disabled}
					class="rounded-[6px] border-0 bg-red-500/10 px-[12px] py-[8px] text-[12px] font-semibold text-red-500 hover:bg-red-500/20"
					onclick={() =>
						send({
							type: "session/delete",
							requestId: crypto.randomUUID(),
							sessionId: session.sessionId,
						})}>セッションを削除</AlertDialog.Action
				>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
