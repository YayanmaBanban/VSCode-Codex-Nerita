<!-- モデル設定・添付・コンテキスト・利用枠を表示し、接続状態に応じて設定変更を Host へ要求する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import BackendSettingsSurface from "../../contributions/BackendSettingsSurface.svelte";
	import ContributionSlot from "../../contributions/ContributionSlot.svelte";
	import Attachments from "./Attachments.svelte";
	import ContextPickerTrigger from "./ContextPickerTrigger.svelte";
	import ContextUsage from "./ContextUsage.svelte";

	let {
		state,
		send,
		onOpenContext,
	}: {
		state: ChatState;
		send: (message: UiMessage) => void;
		onOpenContext?: (() => void) | undefined;
	} = $props();
	let connected = $derived(settingsConnected(state));
	let configurationPending = $derived(
		!connected || state.configPending || state.run === "running",
	);
	let disabled = $derived(configurationPending || state.run === "cancelling");
	/** 設定変更が可能な会話に、対象設定と選択値を指定して変更を要求する。 */
	function change(configId: string, value: string) {
		if (isNonEmptyString(state.sessionId) && !disabled) {
			send({
				type: "config/set",
				requestId: crypto.randomUUID(),
				sessionId: state.sessionId,
				configId,
				value,
			});
		}
	}
	/** 現在の会話に属する添付の表示・削除を要求し、会話がない場合は送らない。 */
	function attachment(
		type: "attachment/open" | "attachment/remove",
		attachmentId: string,
	) {
		if (!isNonEmptyString(state.sessionId)) {
			return;
		}
		send({
			type,
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId,
			attachmentId,
		});
	}
	/** 設定を操作できる接続と会話があるか確認する。 */
	function settingsConnected(state: ChatState) {
		const matchesConnection = !(
			state.connection === "ready" ||
			(state.piAccount !== null && state.connection === "auth-required")
		);
		if (matchesConnection) {
			return false;
		}
		return isNonEmptyString(state.sessionId) && !state.sessionPending;
	}
</script>

<div class="composer-settings min-w-0">
	{#if state.uiContributions}<div
			class="flex flex-wrap items-center gap-[6px]"
		>
			<ContributionSlot
				name="model.header"
				contributions={state.uiContributions}
				{disabled}
				onChange={change}
			/>
		</div>{/if}
	<Attachments
		files={state.attachments}
		{disabled}
		onOpen={(id: string) => attachment("attachment/open", id)}
		onRemove={(id: string) => attachment("attachment/remove", id)}
	/>
	<div
		class="settings-toolbar flex flex-wrap items-center gap-x-[6px] gap-y-[4px]"
		aria-label="モデル設定"
	>
		<ContextPickerTrigger disabled={!connected} onOpen={onOpenContext} />
		{#key state.sessionId ?? "disconnected"}<ContextUsage
				usage={state.usage}
			/>{/key}
		{#if state.uiContributions}<ContributionSlot
				name="composer.toolbar"
				contributions={state.uiContributions}
				{disabled}
				onChange={change}
			/><BackendSettingsSurface
				contributions={state.uiContributions}
				{disabled}
				onChange={change}
			/><ContributionSlot
				name="status"
				contributions={state.uiContributions}
				{disabled}
				onChange={change}
			/>{/if}
	</div>
</div>
