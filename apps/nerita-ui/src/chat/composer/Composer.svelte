<!-- チャットの入力・添付・設定・送信・停止を組み立て、接続状態と入力ロックに合わせて操作を制御する。 -->
<script lang="ts">
	import type { Bridge } from "@nerita/shared/bridge";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { ComposerPart } from "@nerita/shared/composerContent";
	import type { UiMessage } from "@nerita/shared/messages";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import { cn } from "cnfast";
	import { iconButtonClass } from "../messages/messageStyles";
	import Tooltip from "../../ui/Tooltip.svelte";
	import ComposerInput from "./ComposerInput.svelte";
	import ComposerSettings from "./ComposerSettings.svelte";
	import { useAttachmentDrop } from "./useAttachmentDrop.svelte";

	let props: {
		bridge?: Bridge;
		parts: ComposerPart[];
		setDraft: (parts: ComposerPart[]) => void;
		submit: () => void;
		busy: boolean;
		available: boolean;
		locked?: boolean;
		state: ChatState;
		send: (message: UiMessage) => void;
	} = $props();
	const drop = useAttachmentDrop({
		get state() {
			return props.state;
		},
		get locked() {
			return props.locked ?? false;
		},
		get send() {
			return props.send;
		},
	});
	let contextRequest = $state(0);
	let inputLocked = $derived((props.locked ?? false) || drop.reading);
	let sendLabel = $derived(props.busy ? "フォローアップを送信" : "送信");
	let attach = $derived(
		attachmentAction(props.state, inputLocked, props.send),
	);
	/** 現在の会話と Run を明示して停止を要求し、対象が確定していなければ送信しない。 */
	function cancel() {
		if (!isNonEmptyString(props.state.sessionId)) {
			return;
		}
		if (!isNonEmptyString(props.state.runId)) {
			return;
		}
		props.send({
			type: "prompt/cancel",
			requestId: crypto.randomUUID(),
			sessionId: props.state.sessionId,
			runId: props.state.runId,
		});
	}
	/** 添付可能な状態でのみ、Host のファイル選択を開く操作を渡す。 */
	function attachmentAction(
		state: ChatState,
		locked: boolean,
		send: (message: UiMessage) => void,
	) {
		if (!isNonEmptyString(state.sessionId)) {
			return undefined;
		}
		if (state.connection !== "ready") {
			return undefined;
		}
		if (state.sessionPending) {
			return undefined;
		}
		const matchesConfigPending =
			state.configPending ||
			state.attachmentPending ||
			!state.attachmentsSupported;
		if (matchesConfigPending) {
			return undefined;
		}
		if (state.run === "running" || state.run === "cancelling" || locked) {
			return undefined;
		}
		const sessionId = state.sessionId;
		return () =>
			send({
				type: "attachment/add",
				requestId: crypto.randomUUID(),
				sessionId,
			});
	}

	/** 添付の読み取り・接続・本文の準備が揃っている場合だけ送信を有効にする。 */
	function sendDisabled() {
		const unavailable =
			drop.reading ||
			!props.available ||
			!isNonEmptyString(props.state.sessionId);
		return (
			unavailable || !props.parts.some((part) => part.text.trim() !== "")
		);
	}
</script>

<form
	class={cn(
		"composer relative mx-[14px] mt-[8px] mb-[14px] rounded-[10px] border border-solid border-input-border bg-input p-[12px]",
		drop.active && "outline-2 outline-focus",
	)}
	onpastecapture={drop.handlers.onPasteCapture}
	ondragentercapture={drop.handlers.onDragEnterCapture}
	ondragovercapture={drop.handlers.onDragOverCapture}
	ondragleavecapture={drop.handlers.onDragLeaveCapture}
	ondropcapture={drop.handlers.onDropCapture}
	onsubmit={(event) => {
		event.preventDefault();
		if (!drop.reading) {
			props.submit();
		}
	}}
>
	{#if drop.active}
		<div
			class={cn(
				"pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[10px] bg-input",
				"p-3 text-center text-input-text",
			)}
			role="status"
		>
			ドロップしてファイルを添付
		</div>
	{/if}
	{#if drop.error !== ""}
		<p role="alert" class="text-[12px] text-tool-error">
			{drop.error}
		</p>
	{/if}
	<div inert={inputLocked} aria-busy={inputLocked}>
		<ComposerInput
			{contextRequest}
			onAttach={attach}
			collaborationModes={props.state.uiContributions?.surface ===
				"codex"}
			completionScope={`${props.state.connection}:${props.state.cwd}:${props.state.sessionId}`}
			bridge={props.bridge}
			locked={inputLocked}
			attachments={props.state.attachments}
			skills={props.state.skills}
			followUp={props.state.run === "running" &&
				props.state.connection === "ready"}
			parts={props.parts}
			onChange={props.setDraft}
			onSubmit={props.submit}
		/>
	</div>
	<div
		class="composer-footer mt-[12px] flex items-center justify-between gap-[10px]"
	>
		<div class="min-w-0 flex-1" inert={inputLocked}>
			<ComposerSettings
				state={props.state}
				send={props.send}
				onOpenContext={() => {
					contextRequest += 1;
				}}
			/>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if props.busy}
				<Tooltip content="停止">
					{#snippet children({ props: triggerProps })}
						<button
							{...triggerProps}
							type="button"
							class={cn(
								iconButtonClass,
								"stop-button bg-[#bd3948]",
							)}
							aria-label="停止"
							disabled={props.state.run === "cancelling"}
							onclick={cancel}
						>
							<span
								class="size-[14px] rounded-[2px] bg-white"
								aria-hidden="true"
							></span>
						</button>
					{/snippet}
				</Tooltip>
			{/if}
			<Tooltip content={sendLabel}>
				{#snippet children({ props: triggerProps })}
					<button
						{...triggerProps}
						type="submit"
						class={cn(iconButtonClass, "send-button bg-[#2563b8]")}
						aria-label={sendLabel}
						disabled={sendDisabled()}
					>
						<ArrowUp size={18} aria-hidden="true" />
					</button>
				{/snippet}
			</Tooltip>
		</div>
	</div>
</form>
