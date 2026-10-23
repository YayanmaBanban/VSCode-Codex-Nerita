<!-- 会話の下書きと送信の受付状態を入力欄へ接続し、送信ロックと失敗の通知を表示へ反映する。 -->
<script lang="ts">
	import { onDestroy } from "svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import NotificationCard from "../NotificationCard.svelte";
	import Composer from "./Composer.svelte";
	import { useComposerDraft } from "./useComposerDraft.svelte";
	import { usePromptSubmission } from "./usePromptSubmission.svelte";

	let props: {
		bridge: Bridge;
		state: ChatState;
		send: (message: UiMessage) => void;
		busy: boolean;
		visible: boolean;
		onLockChange: (locked: boolean) => void;
	} = $props();
	const draft = useComposerDraft({
		get bridge() {
			return props.bridge;
		},
	});
	const submission = usePromptSubmission({
		get bridge() {
			return props.bridge;
		},
		get state() {
			return props.state;
		},
		get draft() {
			return draft.draft;
		},
		clearDraft: () => draft.setDraft(""),
		get send() {
			return props.send;
		},
		get parts() {
			return draft.parts;
		},
	});
	// Host 応答でも変わる送信ロックを親へ通知するため、入力イベントだけでは同期できない。
	$effect(() => props.onLockChange(submission.locked));
	onDestroy(() => props.onLockChange(false));
</script>

{#if props.visible}
	{#if submission.notice}
		{#key submission.notice.id}
			<NotificationCard
				onClose={submission.dismissNotice}
				backgroundColor="var(--nerita-input-validation-error-background)"
				children={submission.notice.text}
			/>
		{/key}
	{/if}
	<Composer
		bridge={props.bridge}
		state={props.state}
		send={props.send}
		busy={props.busy}
		parts={draft.parts}
		setDraft={draft.setDraft}
		submit={submission.submit}
		locked={submission.locked}
		available={submission.available}
	/>
{/if}
