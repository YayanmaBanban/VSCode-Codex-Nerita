<!-- PC と共通の会話操作とバックエンド選択を、モバイルのヘッダーに表示する。 -->
<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import { cn } from "cnfast";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Unplug from "@lucide/svelte/icons/unplug";
	import type { RemoteChatState } from "@nerita/shared/remote/contracts";
	import BackendMenu from "../chat/connection/BackendMenu.svelte";
	import SessionHeaderActions from "../chat/connection/SessionHeaderActions.svelte";
	import Tooltip from "../ui/Tooltip.svelte";

	let {
		host,
		chat,
		available,
		sessionsOpen,
		onNewChat,
		onToggleSessions,
		onSelectBackend,
		onDisconnect,
	}: {
		host: string;
		chat: RemoteChatState | undefined;
		available: boolean;
		sessionsOpen: boolean;
		onNewChat: () => void;
		onToggleSessions: () => void;
		onSelectBackend: (backend: RemoteChatState["backend"]) => void;
		onDisconnect: () => void;
	} = $props();
	const currentTitle = $derived(chat?.sessionTitle?.trim() ?? "");
	const fallback = $derived(chat === undefined ? "Nerita" : "新規チャット");
	const title = $derived(currentTitle === "" ? fallback : currentTitle);
	const canSwitch = $derived(
		available &&
			chat?.availableBackends.some((option) => option.selectable) ===
				true,
	);
</script>

<header
	class="flex flex-wrap items-center justify-between gap-2.5 border-0 border-b border-solid border-panel-border px-1 py-4"
>
	<div class="min-w-0 flex-[1_1_8rem]">
		<h1 class="m-0 truncate text-[22px] tracking-tight">{title}</h1>
		<p class="m-0 text-[13px] text-muted">{host}</p>
	</div>
	{#if chat}
		<div class="flex items-center gap-0.5">
			<SessionHeaderActions
				available={available && chat.canManageSessions}
				canList={chat.connection === "ready"}
				{sessionsOpen}
				{onNewChat}
				{onToggleSessions}
			/>
			<DropdownMenu.Root>
				<Tooltip content="オプション">
					{#snippet children({ props })}
						<DropdownMenu.Trigger
							{...props}
							aria-label="オプション"
							class="inline-grid size-[44px] place-items-center border-0 bg-transparent p-0 enabled:hover:bg-settings-hover"
						>
							<Ellipsis size={16} aria-hidden="true" />
						</DropdownMenu.Trigger>
					{/snippet}
				</Tooltip>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						class={cn(
							"z-30 min-w-[160px] rounded-[6px] border border-solid border-menu-border bg-menu p-[5px]",
							"text-menu-text shadow-[0_6px_24px_#0003]",
						)}
						side="bottom"
						align="end"
						sideOffset={6}
						collisionPadding={8}
					>
						<BackendMenu
							backend={chat.backend}
							disabled={!canSwitch}
							onSelect={onSelectBackend}
						/>
						<DropdownMenu.Item
							class={cn(
								"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] leading-normal outline-none",
								"data-disabled:opacity-50 data-highlighted:bg-menu-hover",
							)}
							disabled={!available}
							onSelect={onDisconnect}
						>
							<Unplug
								size={16}
								class="shrink-0"
								aria-hidden="true"
							/>
							<span>接続解除</span>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
	{/if}
</header>
