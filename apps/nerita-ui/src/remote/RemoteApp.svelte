<!-- 接続の状態に応じて、ペアリング・サイドバー・チャットを組み立てる。 -->
<script lang="ts">
	import type { BackendId } from "@nerita/shared/backend";
	import { cn } from "cnfast";
	import SessionPanel from "../chat/sessions/SessionPanel.svelte";
	import { useRemoteSessionPanel } from "./useRemoteSessionPanel.svelte";
	import RemoteHeader from "./RemoteHeader.svelte";
	import { browserRemoteTransport, type RemoteTransport } from "./api";
	import { useRemoteConnection } from "./useRemoteConnection.svelte";
	import { useRemoteFiles } from "./useRemoteFiles.svelte";
	import RemotePairing from "./RemotePairing.svelte";
	import RemoteSidebar from "./RemoteSidebar.svelte";
	import RemoteConversation from "./RemoteConversation.svelte";
	import RemoteComposer from "./RemoteComposer.svelte";

	let {
		transport = browserRemoteTransport,
		hostname,
	}: {
		transport?: RemoteTransport;
		hostname?: string;
	} = $props();

	const connection = useRemoteConnection({
		getTransport: () => transport,
		getHostname: () => hostname,
		onResetFiles: () => workspace.reset(),
		onRefreshFiles: () => {
			void workspace.files({ type: "list" });
		},
	});
	const workspace = useRemoteFiles({
		getTransport: () => transport,
		getChat: () => connection.chat,
		getConnected: () => connection.connected,
		getCsrf: () => connection.csrf,
		notify: connection.notify,
	});
	const chat = $derived(connection.chat);
	const history = useRemoteSessionPanel(connection);
	const file = $derived(workspace.preview);
</script>

<svelte:window
	ononline={connection.goOnline}
	onoffline={connection.goOffline}
/>

<div
	class={cn(
		"remote-page flow-root min-h-dvh bg-[var(--nerita-editor-background)] font-sans text-foreground",
		"[&_.sidebar-floating]:rounded-[0.8rem] [&_.sidebar-floating]:border-panel-border [&_.sidebar-floating]:bg-[var(--nerita-side-bar-background)]",
		"[&_[data-sidebar-toggle]]:size-[44px] [&_[data-sidebar-toggle]:enabled:hover]:bg-settings-hover",
	)}
>
	<div
		class={cn(
			"mx-auto max-w-3xl px-3",
			chat &&
				connection.access === "chat" &&
				"grid h-dvh max-w-[96rem] grid-rows-[auto_minmax(0,1fr)]",
		)}
	>
		<RemoteHeader
			host={connection.host}
			{chat}
			available={connection.canOperate}
			sessionsOpen={history.panel.open}
			onNewChat={() => {
				if (chat !== undefined) {
					void connection.manageSession(chat, "session.new");
				}
			}}
			onToggleSessions={history.panel.toggle}
			onSelectBackend={(backend: BackendId) => {
				if (chat !== undefined) {
					void connection.selectBackend(chat, backend);
				}
			}}
			onDisconnect={() => {
				void connection.disconnect();
			}}
		/>

		{#if connection.access === "pair"}
			<RemotePairing
				offline={connection.offline}
				pending={connection.pending}
				feedback={connection.feedback}
				submitCode={connection.submitCode}
			/>
		{:else if chat && connection.access === "chat"}
			<div
				class="relative flex min-h-0 overflow-x-clip py-3 [&_#session-panel_.session-item_button]:border-0"
			>
				<div
					class={cn(
						"flex min-h-0 min-w-0 flex-1",
						"[--sidebar-collapsed-width:44px] [--sidebar-expanded-width:clamp(12rem,23vw,17rem)] [--sidebar-gap:0.5rem]",
						"[--sidebar-panel-height:100%] [--sidebar-panel-padding:0_0.625rem_0_0] [&_.sidebar-sticky]:top-0",
						"[&_.sidebar-layout>aside]:rounded-[0.8rem] [&_.sidebar-layout>aside]:border-panel-border",
						"[&_.sidebar-layout>aside]:bg-[var(--nerita-side-bar-background)]",
					)}
					inert={history.panel.open && history.panel.compact}
				>
					<RemoteSidebar
						changes={workspace.changes}
						fileBusy={workspace.busy}
						idle={connection.canOperate && chat.canManageSessions}
						onRefresh={() => {
							void workspace.files({ type: "list" });
						}}
						onRead={(path: string) =>
							workspace.files({ type: "read", path })}
						onCommit={workspace.commitChanges}
						onStage={(path: string) =>
							workspace.files({ type: "stage", path })}
						onPush={workspace.confirmPush}
					>
						<div
							class={cn(
								"grid h-full grid-rows-[minmax(0,1fr)] gap-3",
								file !== undefined &&
									"grid-rows-[minmax(0,2fr)_minmax(0,3fr)] min-[56rem]:grid-cols-2 min-[56rem]:grid-rows-[minmax(0,1fr)]",
							)}
						>
							{#if file}
								<section
									class="min-h-0 min-w-0 overflow-auto rounded-[0.8rem] border border-solid border-panel-border bg-input p-3"
									aria-label="ファイル内容"
								>
									<div
										class="flex items-center justify-between gap-1.5"
									>
										<h2
											class="m-0 text-lg [overflow-wrap:anywhere]"
										>
											{file.path}
										</h2>
										<button
											type="button"
											class="rounded-[0.6rem] border border-solid border-panel-border bg-secondary px-3 py-2 text-primary-text"
											onclick={workspace.closePreview}
										>
											チャットを全体に表示
										</button>
									</div>
									<pre
										class="mt-2 [overflow-wrap:anywhere] whitespace-pre-wrap">{file.text}</pre>
								</section>
							{/if}
							<div
								class="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]"
							>
								<RemoteConversation
									{chat}
									connected={connection.connected}
									offline={connection.offline}
									status={connection.status}
									canOperate={connection.canOperate}
									answer={connection.answer}
								/>
								<RemoteComposer
									{chat}
									canOperate={connection.canOperate}
									feedback={connection.feedback}
									bind:draft={connection.draft}
									submitPrompt={connection.submitPrompt}
									stopRun={connection.stopRun}
								/>
							</div>
						</div>
					</RemoteSidebar>
				</div>
				{#if history.panel.open}
					<SessionPanel
						state={history.state}
						compact={history.panel.compact}
						send={history.send}
						onClose={history.panel.close}
						restoreOnly
					/>
				{/if}
			</div>
		{:else}
			<main
				class={cn(
					"mx-auto mt-[clamp(2rem,10vh,6rem)] mb-4 max-w-md p-[clamp(1rem,5vw,1.75rem)]",
					"rounded-2xl border border-solid border-panel-border bg-input",
				)}
			>
				<h2 role="status" class="m-0 text-lg">{connection.status}</h2>
				<p class="mt-2.5">
					PCのNeritaとTailscaleの接続を確認してください。
				</p>
			</main>
		{/if}
	</div>
</div>

<style>
	/* 共有部品も含めたブラウザー側の基本スタイル。各要素のユーティリティを優先する。 */
	@layer base {
		:global(.remote-page *) {
			box-sizing: border-box;
		}
		:global(.remote-page button) {
			min-width: 44px;
			min-height: 44px;
			font: inherit;
			touch-action: manipulation;
			cursor: pointer;
		}
		:global(.remote-page button:disabled) {
			opacity: 0.6;
			cursor: default;
		}
		:global(.remote-page input),
		:global(.remote-page textarea) {
			font: inherit;
		}
		:global(.remote-page :focus-visible) {
			outline: 2px solid var(--nerita-focus-border);
			outline-offset: 2px;
		}
	}
</style>
