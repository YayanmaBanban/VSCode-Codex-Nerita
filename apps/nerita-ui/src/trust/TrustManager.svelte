<!-- 信頼記録を検索・表示し、信頼の変更要求と Host の応答を一覧へ反映する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";
	import TrustConfirmationDialog from "./TrustConfirmationDialog.svelte";

	import "../chat/chat.css";

	import { onMount } from "svelte";

	let { bridge }: TrustManagerProps = $props();
	let snapshot = $state.raw<TrustReply>();
	let query = $state("");
	let busy = $state(false);
	let pendingRequest: string | undefined;
	let revision = 0;
	/** 操作中は一致する完了応答だけを反映し、遅れて届く古い一覧を破棄する。 */
	function receive(reply: TrustReply) {
		if ((reply.revision ?? revision) < revision) {
			return;
		}
		const unrelated =
			pendingRequest !== undefined && reply.requestId !== pendingRequest;
		if (unrelated) {
			return;
		}
		revision = reply.revision ?? revision;
		snapshot = reply;
		pendingRequest = undefined;
		busy = false;
	}
	onMount(() => {
		const stop = bridge.subscribe(receive);
		send({ type: "refresh" });
		return stop;
	});

	let records = $derived(
		[...(snapshot?.records ?? [])]
			.sort((left, right) => left.root.localeCompare(right.root))
			.filter((record) =>
				record.root
					.toLocaleLowerCase()
					.includes(query.toLocaleLowerCase()),
			),
	);

	import {
		iconButtonStyle,
		type TrustManagerProps,
	} from "./TrustManagerParts";
	import TrustManagerHeader from "./TrustManagerHeader.svelte";
	import TrustRecord from "./TrustRecord.svelte";
	/** 信頼記録の操作を Host へ送り、応答が届くまで待機状態にする。 */
	const send = (message: TrustRequest) => {
		if (busy) {
			return;
		}
		busy = true;
		pendingRequest = crypto.randomUUID();
		bridge.postMessage({
			...message,
			requestId: pendingRequest,
			backend: message.backend ?? snapshot?.backend,
		});
	};

	/** 信頼記録をフォルダのパスで絞り込む検索語を保持する。 */
	const setQuery = (value: string) => {
		query = value;
	};

	import type {
		TrustRequest,
		TrustReply,
		TrustConfirmation,
	} from "@nerita/shared/workspaceTrust";

	const trustedCount = $derived(
		records.filter((record) => record.trust === "trusted").length,
	);
</script>

<main
	class={cn(
		"mx-auto grid w-full max-w-5xl gap-4 p-4 text-foreground",
		"sm:p-5",
	)}
>
	<TrustManagerHeader
		{...{ busy, send }}
		backend={snapshot?.backend ?? "pi"}
		piStoragePath={snapshot?.piStoragePath}
	/>
	<div class="flex min-w-0 items-center gap-2">
		<label class="min-w-0 flex-1 text-sm">
			<span class="sr-only">フォルダを検索</span>
			<input
				class={cn(
					"w-full rounded border border-input-border bg-input p-2 text-foreground",
				)}
				type="search"
				value={query}
				oninput={(event) => setQuery(event.currentTarget.value)}
				placeholder="フォルダを検索"
			/>
		</label>
		<SettingsTooltip content="ワークスペースの追加">
			{#snippet children({ props })}
				<button
					{...props}
					type="button"
					class={iconButtonStyle}
					disabled={busy}
					aria-label="ワークスペースの追加"
					onclick={() => send({ type: "add" })}
					><Plus size={16} aria-hidden="true" /></button
				>
			{/snippet}
		</SettingsTooltip>
		<SettingsTooltip content="再読み込み">
			{#snippet children({ props })}
				<button
					{...props}
					type="button"
					class={iconButtonStyle}
					disabled={busy}
					aria-label="再読み込み"
					onclick={() => send({ type: "refresh" })}
					><RotateCw size={15} aria-hidden="true" /></button
				>
			{/snippet}
		</SettingsTooltip>
	</div>
	{#if isNonEmptyString(snapshot?.error)}
		<p role="alert" class="m-0 text-sm break-words">{snapshot.error}</p>
	{/if}
	<div
		role="status"
		class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"
	>
		<p class="m-0">
			{snapshot ? `${records.length} 件のフォルダ` : "読み込み中…"}
		</p>
		{#if snapshot}<p class="m-0">信頼済み {trustedCount} 件</p>{/if}
	</div>
	<div
		class="overflow-hidden rounded-lg border border-input-border"
		aria-busy={busy}
	>
		{#each records as record (record.root)}
			<TrustRecord {...{ record, busy, send }} />
		{/each}{#if snapshot && records.length === 0}
			<p class="m-0 p-4 text-sm text-muted">
				{query !== ""
					? "一致するフォルダがありません。"
					: "信頼されたワークスペースはありません。"}
			</p>
		{/if}
	</div>
	<p class="m-0 text-xs text-muted">
		設定から削除しても、フォルダやファイルは残ります。
	</p>
</main>

<TrustConfirmationDialog
	confirmation={snapshot?.confirmation ?? null}
	{busy}
	onConfirm={(confirmation: TrustConfirmation) =>
		send({
			type: "trust",
			root: confirmation.root,
			backend: confirmation.backend,
			confirmationId: confirmation.id,
		})}
	onCancel={() => send({ type: "refresh" })}
/>
