<!-- PC からリモート公開を切り替え、認証が済むまで一時コードを表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { Popover, Switch, mergeProps } from "bits-ui";
	import Monitor from "@lucide/svelte/icons/monitor";
	import MonitorCheck from "@lucide/svelte/icons/monitor-check";
	import type {
		RemoteWorkspaceAction,
		RemoteWorkspaceState,
	} from "@nerita/shared/remote/workspaceControls";
	import ConfirmationDialog from "../../ui/ConfirmationDialog.svelte";
	import PairingCode from "./PairingCode.svelte";
	import StatusIndicator from "../../ui/StatusIndicator.svelte";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { useSettingsPopup } from "../../ui/settingsPopup.svelte";

	let {
		state: remote,
		send,
	}: {
		state: RemoteWorkspaceState;
		send: (message: RemoteWorkspaceAction) => void;
	} = $props();
	const popup = useSettingsPopup();
	const hostnameId = $props.id();
	let trigger = $state<HTMLButtonElement | null>(null);
	let host = $derived(remote.hostname);
	let on = $derived(remote.phase === "on");
	let stopping = $derived(remote.phase === "stopping");
	let starting = $derived(remote.phase === "starting");

	/** 入力値で公開を開始し、停止時は現在の公開だけを閉じる。 */
	function toggle(checked: boolean) {
		const requestId = crypto.randomUUID();
		if (checked) {
			send({ type: "ui/remoteStart", requestId, hostname: host });
		} else {
			send({ type: "ui/remoteStop", requestId });
		}
	}

	/** コードが表示されたらダイアログに操作を移す。 */
	$effect(() => {
		if (remote.pairingCode !== null) {
			popup.open = false;
		}
	});

	/** モーダルの終了後はツールバーの入口へフォーカスを戻す。 */
	function restoreFocus(event: Event) {
		event.preventDefault();
		trigger?.focus({ preventScroll: true });
	}

	/** 現在表示中のコードだけを破棄する。 */
	function dismiss() {
		if (remote.pairingCode !== null) {
			send({
				type: "ui/remoteDismissPairing",
				requestId: crypto.randomUUID(),
				code: remote.pairingCode,
			});
		}
	}
</script>

<Popover.Root bind:open={popup.open}>
	<Popover.Trigger>
		{#snippet child({ props: triggerProps })}
			<Tooltip content="リモートアクセス" disabled={popup.open}>
				{#snippet children({ props: tooltipProps })}
					<button
						bind:this={trigger}
						{...mergeProps(
							{ ...triggerProps },
							{ ...tooltipProps },
						)}
						type="button"
						aria-label="リモートアクセス"
						class={cn(
							"inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted",
							"hover:bg-settings-hover focus-visible:outline-1 focus-visible:outline-settings-focus",
						)}
					>
						{#if remote.connected}
							<MonitorCheck
								size={16}
								class="text-[var(--vscode-charts-green,#388a34)]"
								aria-hidden="true"
							/>
						{:else if on}
							<!-- monitor-activity (Lucide Contributors, ISC) -->
							<svg
								class="lucide-monitor-activity text-[var(--vscode-charts-yellow,#b58b00)]"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M12 17v4" />
								<path
									d="M18 10h-2.315a1 1 0 00-.932.64l-.787 2.034a.5.5 0 01-.932 0l-2.068-5.348a.5.5 0 00-.932 0l-.787 2.035a1 1 0 01-.932.639H6"
								/>
								<path d="M8 21h8" />
								<rect
									x="2"
									y="3"
									width="20"
									height="14"
									rx="2"
								/>
							</svg>
						{:else}
							<Monitor size={16} aria-hidden="true" />
						{/if}
					</button>
				{/snippet}
			</Tooltip>
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			side="top"
			align="start"
			sideOffset={8}
			collisionPadding={12}
			role="dialog"
			aria-label="リモートアクセス設定"
			onCloseAutoFocus={popup.onCloseAutoFocus}
			class={cn(
				"z-20 grid w-[min(300px,calc(100vw-24px))] gap-3 rounded-[18px] border border-solid border-menu-border bg-menu",
				"p-[12px] text-xs text-menu-text shadow-[0_6px_24px_#0003]",
			)}
		>
			<div class="flex items-center justify-between gap-2">
				<h2 class="m-0 text-xs font-medium">リモートアクセス</h2>
				<Switch.Root
					type="button"
					aria-label="リモートアクセス"
					checked={on || starting}
					disabled={stopping}
					onCheckedChange={toggle}
					class={cn(
						"inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-input p-0.5 ring-1 ring-input-border",
						"focus-visible:outline-1 focus-visible:outline-settings-focus disabled:opacity-50 data-[state=checked]:bg-[#2563b8]",
					)}
				>
					<Switch.Thumb
						class="size-5 rounded-full bg-white data-[state=checked]:translate-x-4"
					/>
				</Switch.Root>
			</div>
			<div class="grid gap-1">
				<label for={hostnameId}>接続先</label>
				<input
					id={hostnameId}
					type="text"
					placeholder="空欄でこの PC を自動検出"
					value={host}
					oninput={(event) => (host = event.currentTarget.value)}
					disabled={remote.phase !== "off"}
					maxlength={253}
					autocomplete="off"
					spellcheck={false}
					class={cn(
						"w-full min-w-0 rounded border border-input-border bg-input px-2 py-1.5",
						"focus-visible:outline-1 focus-visible:outline-settings-focus",
					)}
				/>
			</div>
			{#if on}
				<p class="m-0 flex items-center gap-1.5" role="status">
					<StatusIndicator
						status={remote.connected ? "completed" : "idle"}
					/>
					{remote.connected ? "接続中" : "接続待ち"}
				</p>
				<div class="flex flex-wrap gap-2">
					{#if remote.connected}
						<button
							type="button"
							class="rounded border border-input-border px-2 py-1 hover:bg-settings-hover"
							onclick={() =>
								send({
									type: "ui/remoteRevoke",
									requestId: crypto.randomUUID(),
								})}
						>
							リモート端末を切断
						</button>
					{:else}
						<button
							type="button"
							class="rounded border border-input-border px-2 py-1 hover:bg-settings-hover"
							onclick={() =>
								send({
									type: "ui/remotePair",
									requestId: crypto.randomUUID(),
								})}
						>
							ペアリングコードを表示
						</button>
					{/if}
				</div>
			{:else if starting || stopping}
				<p class="m-0" role="status">
					{starting
						? "Tailscale Serve を開始中…"
						: "Tailscale Serve を停止中…"}
				</p>
			{/if}
			{#if remote.error}
				<p class="m-0 text-warning" role="alert">{remote.error}</p>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<ConfirmationDialog
	open={remote.pairingCode !== null}
	title="リモートアクセス"
	description="接続先で以下の URL を開き、受付時間内にペアリングコードを入力してください。"
	onCancel={dismiss}
	onCloseAutoFocus={restoreFocus}
>
	<div class="mx-auto my-4 grid w-full max-w-[20rem] gap-3">
		<p
			class={cn(
				"m-0 min-w-0 rounded border border-input-border bg-input px-2 py-2",
				"text-center font-mono text-sm wrap-anywhere select-all",
			)}
		>
			https://{remote.hostname}/
		</p>
		{#if remote.pairingCode !== null && remote.pairingExpiresAt !== null}
			<PairingCode
				code={remote.pairingCode}
				expiresAt={remote.pairingExpiresAt}
			/>
		{/if}
	</div>
	<div class="flex justify-end">
		<button
			type="button"
			class={cn(
				"rounded border border-input-border px-3 py-1.5 text-xs hover:bg-settings-hover",
				"focus-visible:outline-1 focus-visible:outline-settings-focus",
			)}
			onclick={dismiss}
		>
			閉じる
		</button>
	</div>
</ConfirmationDialog>
