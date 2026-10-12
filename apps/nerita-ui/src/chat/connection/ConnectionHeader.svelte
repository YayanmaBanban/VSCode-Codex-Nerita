<!-- タイトル・接続・表示先の操作と認証やエラーの案内を表示する。 -->
<script lang="ts">
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import type { BackendId } from "@nerita/shared/backend";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { SidebarLocation } from "@nerita/shared/sidebar";
	import type { Snippet } from "svelte";
	import { mergeProps } from "bits-ui";
	import List from "@lucide/svelte/icons/list";
	import Maximize2 from "@lucide/svelte/icons/maximize-2";
	import MessageSquareText from "@lucide/svelte/icons/message-square-text";
	import Minimize2 from "@lucide/svelte/icons/minimize-2";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import PersonalityOptions from "../personality/PersonalityOptions.svelte";
	import AuthenticationNotice from "./AuthenticationNotice.svelte";
	import ConnectionButton from "./ConnectionButton.svelte";
	import ActionNotice from "../../ui/ActionNotice.svelte";
	import { noticeClass } from "../../ui/actionNoticeModel";
	type Props = {
		connectionControl?: Snippet;
		title?: string | undefined;
		dlc?: boolean;
		untrusted?: boolean | undefined;
		backend?: BackendId | undefined;
		state: ChatState;
		requestError: string | null;
		available: boolean;
		send: (message: UiMessage) => void;
		sessionsOpen: boolean;
		onToggleSessions: () => void;
		editor: boolean;
		onToggleEditor: () => void;
		sidebarLocation?: SidebarLocation | undefined;
		onSelectSidebar?: ((location: SidebarLocation) => void) | undefined;
	};
	let {
		connectionControl,
		title,
		dlc,
		untrusted,
		backend,
		state,
		requestError,
		available,
		send,
		sessionsOpen,
		onToggleSessions,
		editor,
		onToggleEditor,
		sidebarLocation,
		onSelectSidebar,
	}: Props = $props();
	const headerTitle = $derived(sessionHeaderTitle());
	const viewLabel = $derived(
		editor ? "サイドバーへ戻る" : "エディタグループへ移動",
	);
	const visibleError = $derived(
		isNonEmptyString(requestError) ||
			(state.connection !== "auth-required" &&
				isNonEmptyString(state.error)),
	);
	const iconClass =
		"inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover";
	/** Host の正規の題名、履歴の題名、未命名の順で表示名を選ぶ。 */
	function sessionHeaderTitle() {
		if (title !== undefined) {
			return title;
		}
		const current = nonEmptyString(state.sessionTitle?.trim());
		if (current !== undefined) {
			return current;
		}
		const history = nonEmptyString(
			state.sessions
				.find((session) => session.sessionId === state.sessionId)
				?.title?.trim(),
		);
		return history ?? "新規チャット";
	}
</script>

<header
	class="chat-header flex min-w-0 items-center gap-[6px] border-0 border-b border-solid border-message-border px-[12px] py-[10px]"
>
	<h1
		class="m-0 min-w-0 flex-1 truncate text-[12px] font-medium tracking-normal"
	>
		{headerTitle}
	</h1>
	{#if connectionControl}{@render connectionControl()}{:else}<ConnectionButton
			{state}
			{send}
		/>{/if}
	<div class="flex shrink-0 items-center gap-[2px]">
		{#if dlc !== true}
			<SettingsTooltip content="新しいチャット"
				>{#snippet children({ props })}<button
						{...mergeProps(props, {
							onclick: () =>
								send({
									type: "session/new",
									requestId: crypto.randomUUID(),
								}),
						})}
						type="button"
						class={iconClass}
						aria-label="新しいチャット"
						disabled={!available}
						><MessageSquareText
							size={16}
							aria-hidden="true"
						/></button
					>{/snippet}</SettingsTooltip
			>
			<SettingsTooltip content="セッション一覧"
				>{#snippet children({ props })}<button
						{...mergeProps(props, { onclick: onToggleSessions })}
						type="button"
						id="session-list-toggle"
						class={iconClass}
						aria-label="セッション一覧"
						disabled={!state.sessionCapabilities.list}
						aria-expanded={sessionsOpen}
						aria-controls="session-panel"
						><List size={16} aria-hidden="true" /></button
					>{/snippet}</SettingsTooltip
			>
		{/if}
		<SettingsTooltip content={viewLabel}
			>{#snippet children({ props })}<button
					{...mergeProps(props, { onclick: onToggleEditor })}
					type="button"
					class={iconClass}
					aria-label={viewLabel}
					>{#if editor}<Minimize2
							size={16}
							aria-hidden="true"
						/>{:else}<Maximize2
							size={16}
							aria-hidden="true"
						/>{/if}</button
				>{/snippet}</SettingsTooltip
		>
		{#if dlc !== true}<PersonalityOptions
				{send}
				{state}
				{backend}
				{sidebarLocation}
				{onSelectSidebar}
				error={requestError}
			/>{/if}
	</div>
</header>
{#if visibleError}<div role="alert" class={`error-banner ${noticeClass}`}>
		{nonEmptyString(requestError) ?? state.error}
	</div>{/if}
{#if state.connection === "auth-required" || state.connection === "authenticating"}<AuthenticationNotice
		{state}
		{send}
	/>{/if}
{#if backend === "pi" && untrusted === true}<ActionNotice
		label="ワークスペースの信頼"
		title="ワークスペースが未信頼"
		description="セッションは、グローバル領域（.pi\agent\sessions）に保存されます"
		actions={[
			{
				id: "trust",
				name: "信頼する",
				onClick: () =>
					send({
						type: "workspace/manageTrust",
						requestId: crypto.randomUUID(),
					}),
			},
		]}
	/>{/if}
