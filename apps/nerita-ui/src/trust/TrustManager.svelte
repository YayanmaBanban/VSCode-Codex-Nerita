<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";

	import "../chat/chat.css";

	import { onMount } from "svelte";
	let { bridge }: TrustManagerProps = $props();
	let snapshot = $state.raw<TrustReply>();
	let query = $state("");
	let busy = $state(false);
	onMount(() => {
		const stop = bridge.subscribe((reply) => {
			snapshot = reply;
			busy = false;
		});
		bridge.postMessage({ type: "refresh" });
		return stop;
	});

	let records = $derived(
		snapshot?.records.filter((record) =>
			record.root.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
		) ?? [],
	);

	import { type TrustManagerProps } from "./TrustManagerParts";
	import TrustManagerHeader from "./TrustManagerHeader.svelte";
	import TrustRecord from "./TrustRecord.svelte";
	/** 信頼記録の操作を Host へ送り、応答が届くまで待機状態にする。 */
	const send = (message: TrustRequest) => {
		busy = true;
		bridge.postMessage(message);
	};

	/** 信頼記録をフォルダーのパスで絞り込む検索語を保持する。 */
	const setQuery = (value: string) => {
		query = value;
	};

	import type {
		TrustRequest,
		TrustReply,
	} from "@nerita/shared/workspaceTrust";
</script>

<main
	class={cn(
		"mx-auto grid w-full max-w-5xl gap-5 p-4 text-foreground",
		"sm:p-6",
	)}
>
	<TrustManagerHeader {...{ busy, send }} /><label class="grid gap-2 text-sm"
		>フォルダーを検索
		<input
			class={cn(
				"w-full rounded border border-input-border bg-input p-2 text-foreground",
			)}
			type="search"
			value={query}
			oninput={(event) => setQuery(event.currentTarget.value)}
			placeholder="名前またはパスで検索"
		/></label
	>{#if isNonEmptyString(snapshot?.error)}
		<p role="alert" class="m-0 text-sm break-words">{snapshot.error}</p>
	{/if}
	<p role="status" class="m-0 text-sm text-muted">
		{snapshot
			? `${records.length} 件 / 全 ${snapshot.records.length} 件`
			: "読み込み中…"}
	</p>
	<div class="grid gap-3" aria-busy={busy}>
		{#each records as record (record.root)}
			{#key record.root}
				<TrustRecord {...{ record, busy, send }} />
			{/key}
		{/each}{#if snapshot && records.length === 0}
			<p class="text-sm text-muted">
				{query !== ""
					? "一致するフォルダーがありません。"
					: "保存された記録はありません。"}
			</p>
		{/if}
	</div>
</main>
