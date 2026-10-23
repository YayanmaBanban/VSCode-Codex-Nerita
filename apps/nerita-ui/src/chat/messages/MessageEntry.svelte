<!-- 本文・添付・回答コピーと同じターンの送信文への移動を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import ArrowUpToLine from "@lucide/svelte/icons/arrow-up-to-line";
	import { mergeProps } from "bits-ui";
	import type { ChatMessage } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import MessageText from "./MessageText.svelte";
	import McpMessage from "./McpMessage.svelte";
	import MessageReferenceChip from "./MessageReferenceChip.svelte";
	import CopyButton from "../CopyButton.svelte";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import { messageIconButtonClass, messageFocusClass } from "./messageStyles";

	let {
		message,
		send,
		target,
		jump,
		register,
	}: {
		message: ChatMessage;
		send?: ((message: UiMessage) => void) | undefined;
		target?: ChatMessage | undefined;
		jump: (id: string) => void;
		register?:
			((id: string, element: HTMLElement) => () => void) | undefined;
	} = $props();
	const user = $derived(message.role === "user");
</script>

<article
	class={cn(
		"message",
		message.role,
		"mb-[24px] min-w-0 rounded-[9px] border border-solid p-[14px]",
		messageFocusClass,
		user
			? "border-message-border bg-message-user"
			: "border-transparent bg-transparent",
	)}
	tabindex="-1"
	{@attach (element: HTMLElement) => register?.(message.id, element)}
>
	<div class="message-text leading-[1.85] [overflow-wrap:anywhere]">
		{#if message.mcp}
			<McpMessage content={message.mcp} text={message.text} />
		{:else}
			<MessageText
				text={message.text}
				{send}
				references={user ? message.references : undefined}
				streaming={!user && message.streaming === true}
				streamId={message.id}
			/>
		{/if}
	</div>
	{#if user && message.attachments?.length}
		<div class="mt-2 flex flex-wrap gap-1.5" aria-label="添付ファイル">
			{#each message.attachments as file (file.id)}
				<MessageReferenceChip
					path={{
						kind: "file",
						name: file.name,
						path: file.uri,
						uri: file.uri,
					}}
					{send}
				/>
			{/each}
		</div>
	{/if}
	{#if !user}
		<div
			class={cn(
				"message-actions mt-[10px] flex justify-end gap-[6px]",
				messageFocusClass,
			)}
			tabindex="-1"
		>
			<div
				class="ml-auto flex items-center gap-2 rounded-lg border border-menu-border bg-message-user p-0.5"
			>
				{#if message.mcp?.status !== "loading"}
					<CopyButton
						text={message.text}
						label="回答をコピー"
						className="size-7 rounded-md"
						iconSize={16}
					/>
				{/if}
				<SettingsTooltip content="送信メッセージへ移動">
					{#snippet children({ props })}
						<button
							{...mergeProps(props, {
								onclick: () => {
									if (target) {
										jump(target.id);
									}
								},
							})}
							type="button"
							class={cn(
								messageIconButtonClass,
								"size-7 rounded-md bg-transparent hover:bg-settings-hover",
							)}
							aria-label="送信メッセージへ移動"
							disabled={!target}
							><ArrowUpToLine
								size={16}
								aria-hidden="true"
							/></button
						>
					{/snippet}
				</SettingsTooltip>
			</div>
		</div>
	{/if}
</article>
