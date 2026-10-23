<!-- 通常チャットの接続操作と、独立した DLC 作業画面への入口を表示する。 -->
<script lang="ts">
	import { mergeProps } from "bits-ui";
	import type { ChatWorkspaceHeader } from "./chatWorkspaceModel";
	import ConnectionHeader from "./connection/ConnectionHeader.svelte";
	import ConnectionButton from "./connection/ConnectionButton.svelte";
	import SettingsTooltip from "./SettingsTooltip.svelte";

	let {
		view,
		chat,
		available,
		sessionPanel,
		mode,
	}: ChatWorkspaceHeader & { mode: "chat" | "dlc" } = $props();
	const modes = ["chat", "dlc"] as const;
	/** 選択したモードに対応するエディタの開閉を Host に依頼する。 */
	function selectMode(target: "chat" | "dlc") {
		const requestId = crypto.randomUUID();
		chat.send(
			target === "dlc"
				? { type: "dlc/open", requestId }
				: { type: "ui/setMode", requestId, mode: "chat" },
		);
	}
</script>

<ConnectionHeader
	untrusted={view.untrusted}
	backend={view.backend}
	sidebarLocation={view.sidebarLocation}
	onSelectSidebar={view.selectSidebar}
	state={chat.state}
	editor={view.editor}
	onToggleEditor={view.toggleEditor}
	requestError={chat.requestError}
	{available}
	send={chat.send}
	sessionsOpen={sessionPanel.open}
	onToggleSessions={sessionPanel.toggle}
	dlc={false}
>
	{#snippet connectionControl()}
		<div class="flex shrink-0 items-center gap-1">
			{#if chat.state.connection !== "ready"}
				<ConnectionButton state={chat.state} send={chat.send} />
			{/if}
			<div
				role="group"
				aria-label="作業モード"
				class="chat-mode-switch"
				data-mode={mode}
			>
				<span aria-hidden="true" class="chat-mode-indicator"></span>
				{#each modes as target (target)}
					<SettingsTooltip
						content={target === "chat"
							? "チャットモード"
							: "ライフサイクルモード"}
					>
						{#snippet children({ props })}
							<button
								{...mergeProps(props, {
									onclick: () => selectMode(target),
								})}
								type="button"
								aria-pressed={mode === target}
								>{target === "chat" ? "Chat" : "DLC"}</button
							>
						{/snippet}
					</SettingsTooltip>
				{/each}
			</div>
		</div>
	{/snippet}
</ConnectionHeader>
