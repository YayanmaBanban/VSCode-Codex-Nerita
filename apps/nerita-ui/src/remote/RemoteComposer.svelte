<!-- 固定した入力欄と送信・停止操作を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		remoteTextLimit,
		type RemoteChatState,
	} from "@nerita/shared/remote/contracts";

	let {
		chat,
		feedback,
		canOperate,
		draft = $bindable(""),
		submitPrompt,
		stopRun,
	}: {
		chat: RemoteChatState;
		feedback: string;
		canOperate: boolean;
		draft?: string;
		submitPrompt: () => Promise<void>;
		stopRun: (current: RemoteChatState) => void;
	} = $props();
	const hasText = $derived(draft.trim().length > 0);

	/** 通常のフォーム送信をリモートチャットの送信に渡す。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		void submitPrompt();
	}
</script>

<form
	class={cn(
		"mt-3 mb-[env(safe-area-inset-bottom)] grid gap-1.5 p-3",
		"rounded-[0.8rem] border border-solid border-panel-border bg-input",
	)}
	onsubmit={submit}
	aria-labelledby="composer-label"
>
	{#if feedback !== ""}
		<p class="m-0 mb-2.5 text-sm text-muted" role="status">
			{feedback}
		</p>
	{/if}
	<label id="composer-label" for="prompt" class="text-sm font-semibold">
		メッセージ
	</label>
	<textarea
		id="prompt"
		class={cn(
			"h-[5.25rem] w-full min-w-0 resize-none rounded-[0.6rem] p-2.5",
			"border border-solid border-input-border bg-input text-input-text",
		)}
		bind:value={draft}
		maxlength={remoteTextLimit}
		rows="2"
		required></textarea>
	<div class="flex flex-wrap justify-end gap-1.5">
		<button
			type="button"
			class="rounded-[0.6rem] border border-solid border-panel-border bg-secondary px-3 py-2 text-primary-text"
			disabled={!canOperate ||
				!chat.capabilities.stop ||
				chat.run === "cancelling"}
			onclick={() => stopRun(chat)}
		>
			停止
		</button>
		<button
			type="submit"
			class="rounded-[0.6rem] border-0 bg-primary px-3 py-2 text-primary-text"
			disabled={!canOperate || !chat.capabilities.send || !hasText}
		>
			送信
		</button>
	</div>
</form>
