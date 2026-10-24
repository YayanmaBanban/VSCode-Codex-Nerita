<!-- 信頼記録を検索・表示し、信頼の変更要求と Host の応答を一覧へ反映する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import type { BackendId } from "@nerita/shared/backend";
	import Tooltip from "../ui/Tooltip.svelte";
	import TrustConfirmationDialog from "./TrustConfirmationDialog.svelte";

	import "../chat/chat.css";

	import { onMount, tick } from "svelte";

	let { bridge }: TrustManagerProps = $props();
	let snapshot = $state.raw<TrustReply>();
	let query = $state("");
	let busy = $state(false);
	let error = $state<string | null>(null);
	let backend = $state<BackendId>();
	let piStoragePath = $state<string>();
	let operation = $state<TrustRequest["type"]>("refresh");
	let main = $state<HTMLElement>();
	let completeFocus: (() => void) | undefined;
	let pendingRequest: string | undefined;
	let revision = 0;
	const operationLabels = {
		refresh: "読み込み中…",
		add: "フォルダを選択しています…",
		trust: "信頼設定を確認・保存しています…",
		revoke: "信頼を取り消しています…",
		remove: "設定から削除しています…",
	};
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
		applyReply(reply);
	}
	/** 受理した応答で一覧と待機状態を更新し、削除後は再描画を待ってフォーカスを移す。 */
	function applyReply(reply: TrustReply) {
		backend = reply.backend ?? backend;
		piStoragePath = reply.piStoragePath ?? piStoragePath;
		error = isNonEmptyString(reply.error) ? reply.error : null;
		snapshot = error !== null ? undefined : reply;
		pendingRequest = undefined;
		busy = false;
		const focus = completeFocus;
		completeFocus = undefined;
		void tick().then(() => focus?.());
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
		operation = message.type;
		error = null;
		backend = message.backend ?? backend;
		if (message.type === "remove") {
			completeFocus = focusAfterRemoval(message.root);
		}
		if (message.type === "refresh") {
			snapshot = undefined;
		}
		pendingRequest = crypto.randomUUID();
		bridge.postMessage({
			...message,
			requestId: pendingRequest,
			backend,
		});
	};

	/** 削除元にフォーカスが残っていた場合だけ、応答後に隣の行か検索欄へ移す。 */
	function focusAfterRemoval(root: string) {
		const trigger = main?.ownerDocument.activeElement;
		const index = records.findIndex((record) => record.root === root);
		const next = records[index + 1]?.root ?? records[index - 1]?.root;
		if (!trigger?.closest("[data-trust-root]")) {
			return;
		}
		return () => {
			// 応答待ちに別の操作へ移った場合は、そのフォーカスを奪わない。
			const moved =
				trigger.isConnected ||
				trigger.ownerDocument.activeElement !==
					trigger.ownerDocument.body;
			if (moved) {
				return;
			}
			const row = [
				...(main?.querySelectorAll<HTMLElement>("[data-trust-root]") ??
					[]),
			].find((element) => element.dataset.trustRoot === next);
			(
				row?.querySelector<HTMLButtonElement>(
					"button:not(:disabled)",
				) ?? main?.querySelector<HTMLInputElement>("input[type=search]")
			)?.focus();
		};
	}

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
	bind:this={main}
	class={cn(
		"mx-auto grid w-full max-w-5xl gap-4 p-4 text-foreground",
		"sm:p-5",
	)}
>
	<TrustManagerHeader
		{...{ busy, send }}
		backend={backend ?? "pi"}
		{piStoragePath}
	/>
	<div class="flex min-w-0 items-center gap-2">
		<label class="min-w-0 flex-1 text-[12px]">
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
		<Tooltip content="ワークスペースの追加">
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
		</Tooltip>
		<Tooltip content="再読み込み">
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
		</Tooltip>
	</div>
	{#if error}
		<p
			role="alert"
			class="m-0 flex items-start gap-2 text-[12px] [overflow-wrap:anywhere]"
		>
			<CircleAlert
				size={16}
				class="mt-0.5 shrink-0 text-red-500"
				aria-hidden="true"
			/>
			{error}
		</p>
	{:else}
		<div
			role="status"
			class="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted"
		>
			<p class="m-0 flex items-center gap-2">
				{#if busy}
					<LoaderCircle
						size={16}
						class="shrink-0 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
					{operationLabels[operation]}
				{:else}
					{#if snapshot}
						{records.length} 件のフォルダ
					{/if}
				{/if}
			</p>
			{#if snapshot && !busy}
				<p class="m-0">信頼済み {trustedCount} 件</p>
			{/if}
		</div>
	{/if}
	{#if snapshot}
		<div
			class="overflow-hidden rounded-lg border border-input-border"
			aria-busy={busy}
		>
			{#each records as record (record.root)}
				<TrustRecord {...{ record, busy, send }} />
			{/each}
			{#if records.length === 0}
				<p class="m-0 p-4 text-[12px] text-muted">
					{query !== ""
						? "一致するフォルダがありません。"
						: "信頼されたワークスペースはありません。"}
				</p>
			{/if}
		</div>
		<p class="m-0 text-[12px] text-muted">
			設定から削除しても、フォルダやファイルは残ります。
		</p>
	{/if}
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
