<!-- 空の名前を送信せず、Escape では名前の入力だけを閉じる。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { onMount, untrack } from "svelte";
	import type { UiMessage } from "@nerita/shared/messages";

	let {
		sessionId,
		title,
		disabled,
		send,
		close,
	}: {
		sessionId: string;
		title: string;
		disabled: boolean;
		send: (message: UiMessage) => void;
		close: () => void;
	} = $props();
	let name = $state(untrack(() => title));
	let input = $state<HTMLInputElement>();
	onMount(() => {
		input?.focus();
	});
	/** IME の変換中は Escape を入力側で処理する。 */
	function handleKey(event: KeyboardEvent) {
		if (!event.isComposing && event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}
	/** 有効な名前の確定要求だけを送信する。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (disabled || name.trim() === "") {
			return;
		}
		send({
			type: "session/rename",
			sessionId,
			name: name.trim(),
			requestId: crypto.randomUUID(),
		});
		close();
	}
</script>

<form class="flex flex-wrap gap-[6px] px-[12px] pb-[10px]" onsubmit={submit}>
	<input
		bind:this={input}
		onkeydown={handleKey}
		aria-label="新しいセッション名"
		class={cn(
			"box-border w-full min-w-0 rounded-[4px] border border-solid border-input-border bg-input px-[8px]",
			"py-[6px] text-[12px] text-input-text",
			"focus-visible:outline-2 focus-visible:outline-focus",
		)}
		bind:value={name}
		maxlength={200}
		{disabled}
	/>
	<button
		type="submit"
		onkeydown={handleKey}
		class="text-[12px]"
		disabled={disabled || name.trim() === ""}
	>
		保存
	</button>
	<button
		type="button"
		class="text-[12px]"
		onclick={close}
		onkeydown={handleKey}
	>
		キャンセル
	</button>
</form>
