<!-- チャットの表示先・バックエンド・認証・性格設定の操作をメニューにまとめ、要求中の状態を管理する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { Dialog, DropdownMenu } from "bits-ui";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import FileUser from "@lucide/svelte/icons/file-user";
	import KeyRound from "@lucide/svelte/icons/key-round";
	import LogOut from "@lucide/svelte/icons/log-out";
	import X from "@lucide/svelte/icons/x";
	import type { BackendId } from "@nerita/shared/backend";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { PersonalityMessage } from "@nerita/shared/personality";
	import type { SidebarLocation } from "@nerita/shared/sidebar";
	import Tooltip from "../../ui/Tooltip.svelte";
	import HelpButton from "../../ui/HelpButton.svelte";
	import BackendMenu from "../connection/BackendMenu.svelte";
	import SidebarMenu from "../connection/SidebarMenu.svelte";
	import PersonalityPane from "./PersonalityPane.svelte";

	let {
		backend,
		state: chatState,
		send,
		error,
		sidebarLocation = "secondary",
		onSelectSidebar,
	}: {
		backend?: BackendId | undefined;
		state: ChatState;
		send: (message: UiMessage) => void;
		error: string | null;
		sidebarLocation?: SidebarLocation | undefined;
		onSelectSidebar?: ((location: SidebarLocation) => void) | undefined;
	} = $props();
	let open = $state(false);
	let pending = $state(false);
	let trigger: HTMLButtonElement | null = $state(null);
	// 初期フォーカスでヘルプが開かないよう、閉じるボタンを操作の起点にする。
	let closeButton = $state<HTMLButtonElement | null>(null);
	let blockedRun = $derived(
		chatState.sessionPending ||
			chatState.run === "running" ||
			chatState.run === "cancelling",
	);
	// Host が設定を返した時に要求の待機表示を解くため、メニューの操作だけでは完了できない。
	$effect(() => {
		resetPending(chatState.personality);
	});
	// 非同期に届く失敗でも要求の待機表示を解き、再操作できる状態へ戻す。
	$effect(() => {
		if (error !== null && error !== "") {
			pending = false;
		}
	});
	/** 性格設定の要求を送る前に待機状態へ移り、連打による重複操作を抑止する。 */
	function request(message: PersonalityMessage) {
		pending = true;
		send(message);
	}
	/** 表示先の変更を利用側の操作へ渡し、操作先がなければ Host へ変更を要求する。 */
	function selectSidebar(location: SidebarLocation) {
		if (onSelectSidebar) {
			onSelectSidebar(location);
		} else {
			send({
				type: "ui/setSidebar",
				requestId: crypto.randomUUID(),
				location,
			});
		}
	}
	/** 指定したバックエンドへの切り替えを Host へ要求する。 */
	function selectBackend(value: BackendId) {
		send({
			type: "ui/setBackend",
			requestId: crypto.randomUUID(),
			backend: value,
		});
	}
	const itemClass =
		"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none data-disabled:cursor-default data-disabled:opacity-50 data-highlighted:bg-menu-hover";
	/** Host から新しい性格設定が届いたときに、操作の待機状態を解除する。 */
	function resetPending(_settings: ChatState["personality"]) {
		pending = false;
	}
</script>

<DropdownMenu.Root>
	<Tooltip content="オプション">
		{#snippet children({ props })}
			<DropdownMenu.Trigger
				{...props}
				bind:ref={trigger}
				aria-label="オプション"
				class="inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover"
			>
				<Ellipsis size={16} aria-hidden="true" />
			</DropdownMenu.Trigger>
		{/snippet}
	</Tooltip>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			side="bottom"
			align="end"
			sideOffset={6}
			collisionPadding={8}
			class={cn(
				"z-30 min-w-[180px] rounded-[6px] border border-solid border-menu-border bg-menu p-[5px]",
				"text-menu-text shadow-[0_6px_24px_#0003]",
			)}
		>
			<SidebarMenu location={sidebarLocation} onSelect={selectSidebar} />
			<BackendMenu {backend} onSelect={selectBackend} />
			{#if chatState.piAccount !== null}
				<DropdownMenu.Item
					disabled={blockedRun}
					onSelect={() =>
						send({
							type: "auth/start",
							requestId: crypto.randomUUID(),
							methodId: "pi",
						})}
					class={itemClass}
					><KeyRound
						size={16}
						aria-hidden="true"
					/>認証情報を管理</DropdownMenu.Item
				>
			{/if}
			<DropdownMenu.Item
				onSelect={() => {
					open = true;
					request({
						type: "personality/read",
						requestId: crypto.randomUUID(),
					});
				}}
				class={itemClass}
				><FileUser
					size={16}
					aria-hidden="true"
				/>性格設定</DropdownMenu.Item
			>
			<DropdownMenu.Item
				disabled={chatState.connection !== "ready" || blockedRun}
				onSelect={() =>
					send({
						type: "auth/logout",
						requestId: crypto.randomUUID(),
					})}
				class={itemClass}
				><LogOut
					size={16}
					aria-hidden="true"
				/>ログアウト</DropdownMenu.Item
			>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-black/30" />
		<Dialog.Content
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				closeButton?.focus({ preventScroll: true });
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				trigger?.focus();
			}}
			class={cn(
				"fixed inset-y-[12px] right-[12px] z-50 flex w-[min(460px,calc(100vw-24px))] flex-col rounded-[8px]",
				"border border-solid border-menu-border bg-menu text-menu-text shadow-[0_6px_24px_#0003] outline-none",
			)}
		>
			<div class="flex items-center justify-between px-[16px] py-[12px]">
				<div class="flex items-center gap-1">
					<Dialog.Title class="m-0 text-[14px] font-medium">
						性格設定
					</Dialog.Title>
					<HelpButton
						label="指示の使い分け"
						aboveMenu
						content="使用させたいコマンドなどは、AGENTS.md に記載してください。"
					/>
				</div>
				<Dialog.Close
					bind:ref={closeButton}
					aria-label="性格設定を閉じる"
					class="inline-flex size-[28px] items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover"
				>
					<X size={16} />
				</Dialog.Close>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-[16px] pb-[16px]">
				<Dialog.Description
					class="mt-0 text-[12px] leading-[1.7] text-muted"
				>
					グローバルとワークスペースの指示を、この順で結合します。変更は会話の開始・分岐・再開時に反映されます。
				</Dialog.Description>
				{#if error !== null && error !== ""}
					<p role="alert" class="text-[12px]">
						{error}
					</p>
				{/if}
				{#if pending}
					<p role="status" class="text-[12px]">読み込み・保存中…</p>
				{/if}
				{#if chatState.personality}
					{#each ["global", "workspace"] as scope (scope)}
						<PersonalityPane
							scope={scope === "global" ? "global" : "workspace"}
							settings={chatState.personality[
								scope === "global" ? "global" : "workspace"
							]}
							{pending}
							send={request}
						/>
					{/each}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
