<!-- バックエンドの状態、会話、ツールの進捗と承認を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import type { RemoteChatState } from "@nerita/shared/remote/contracts";
	import { remoteBackendLabels } from "./useRemoteConnection.svelte";

	/** 表示中の操作について選べる承認。 */
	type Approval = RemoteChatState["pendingApprovals"][number];
	let {
		chat,
		connected,
		offline,
		status,
		canOperate,
		answer,
	}: {
		chat: RemoteChatState;
		connected: boolean;
		offline: boolean;
		status: string;
		canOperate: boolean;
		answer: (
			current: RemoteChatState,
			approval: Approval,
			option: Approval["options"][number],
		) => Promise<void>;
	} = $props();
	const toolLabels = {
		pending: "待機中",
		in_progress: "実行中",
		completed: "完了",
		failed: "失敗",
		cancelled: "停止済み",
		unfinished: "未完了",
		unknown: "状態不明",
	} as const;
	const errorLabels = {
		"pi-unavailable":
			"PCでPiの接続とサンドボックスの状態を確認してください。",
		"codex-unavailable":
			"PCでCodex App Serverの接続状態を確認してください。",
		"run-failed": "実行に失敗しました。詳しい情報はPCで確認してください。",
	} as const;
</script>

<main class="overflow-auto">
	<div class="py-4">
		<div>
			<p
				role="status"
				class="mx-0 mt-1 mb-0 flex items-center gap-1.5 text-[13px] text-muted"
			>
				<span
					class={cn(
						"inline-block size-2 shrink-0 rounded-full",
						connected && !offline ? "bg-menu-check" : "bg-muted",
					)}
				></span>{status}
			</p>
		</div>
	</div>

	{#if chat.error !== null}
		<p class="mx-0 mt-0 mb-2.5 text-sm text-muted">
			{errorLabels[chat.error]}
		</p>
	{/if}
	{#if chat.truncated}
		<p class="mx-0 mt-0 mb-2.5 text-sm text-muted">
			省略された会話やツールの詳細はPCで表示できます。
		</p>
	{/if}
	{#if !connected && !offline}
		<p class="mx-0 mt-0 mb-2.5 text-sm text-muted">
			Tailscaleの接続とPCのNeritaを確認してください。実行の状態は再接続後に更新されます。
		</p>
	{/if}

	<div class="grid gap-3" aria-label="会話">
		{#each chat.messages as message (message.id)}
			<article
				class={cn(
					"rounded-[0.8rem] border border-solid border-message-border p-3",
					message.role === "user"
						? "ms-[clamp(0.5rem,7vw,3rem)] bg-message-user"
						: "border-message-assistant-border bg-message-assistant",
				)}
			>
				<h3 class="mx-0 mt-0 mb-1 text-[15px] text-muted">
					{message.role === "user"
						? "あなた"
						: remoteBackendLabels[chat.backend]}
				</h3>
				<p class="m-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
					{message.text}
				</p>
				{#if message.streaming}
					<small class="text-[13px] text-muted">応答中…</small>
				{/if}
			</article>
		{/each}
	</div>

	{#if chat.tools.length > 0}
		<details
			class="mt-3 rounded-[0.8rem] border border-solid border-panel-border bg-input p-3"
		>
			<summary
				class="min-h-[44px] cursor-pointer touch-manipulation content-center"
				>ツールの進捗（{chat.tools.length}）</summary
			>
			<ul class="m-0">
				{#each chat.tools as tool (tool.id)}
					<li>
						{tool.title}
						<span class="text-muted">{toolLabels[tool.status]}</span
						>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#each chat.pendingApprovals as approval (approval.id)}
		<section
			class="mt-3 rounded-[0.8rem] border border-solid border-alert-border bg-alert p-3"
			aria-label="承認待ち"
		>
			<h3 class="m-0 text-[15px]">{approval.title}</h3>
			<p class="mx-0 my-1.5">操作の対象と詳細はPCで確認できます。</p>
			{#if approval.options.length === 0}
				<p class="mx-0 my-1.5">PCで操作してください。</p>
			{:else}
				<div class="flex flex-wrap gap-1.5">
					{#each approval.options as option (option.id)}
						<button
							type="button"
							class="rounded-[0.6rem] border border-solid border-panel-border bg-secondary px-3 py-2 text-primary-text"
							disabled={!canOperate || !chat.capabilities.approve}
							onclick={() => answer(chat, approval, option)}
						>
							{option.kind === "allow" ? "今回だけ許可" : "拒否"}
						</button>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</main>
