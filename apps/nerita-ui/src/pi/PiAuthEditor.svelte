<script lang="ts">
	import { cn } from "cnfast";
	import Search from "@lucide/svelte/icons/search";
	import "../chat/chat.css";

	let { state: hostState, send }: PiAuthEditorProps = $props();
	let query = $state("");
	let expanded = $state<string | null>(null);

	let filtered = $derived(
		hostState.items.filter((item) =>
			`${item.name} ${item.id}`
				.toLowerCase()
				.includes(query.toLowerCase()),
		),
	);

	import { type PiAuthEditorProps } from "./PiAuthEditorParts";
	import AuthProviderItem from "./AuthProviderItem.svelte";

	/** 認証先一覧を絞り込む検索語を保持する。 */
	const setQuery = (value: string) => {
		query = value;
	};

	/** 開く認証先を保持し、閉じた場合は選択を解除する。 */
	const setExpanded = (value: string | null) => {
		expanded = value;
	};
</script>

<main class="mx-auto w-full max-w-[960px] p-[20px] text-[13px]">
	<h1 class="mb-[8px] text-[22px] font-semibold">認証情報を管理</h1>
	<p class="mb-[24px] text-muted">
		認証先を選択して、APIキーやOAuthログインを設定します。
	</p>
	<label
		class={cn(
			"mb-[20px] flex items-center gap-[10px] rounded-[6px] border",
			"border-menu-border bg-menu px-[12px] text-menu-text",
		)}
		><Search size={16} aria-hidden="true" /><input
			aria-label="認証先を検索"
			placeholder="認証先を検索…"
			type="search"
			value={query}
			oninput={(event) => setQuery(event.currentTarget.value)}
			class={cn(
				"min-w-0 flex-1 border-0 bg-transparent py-[12px] text-inherit",
				"outline-none",
			)}
		/></label
	>
	<ul aria-label="認証先" class="m-0 list-none p-0">
		{#each filtered as item (item.id)}
			{@const active = item.methods.some(
				(method) => method.id === hostState.active,
			)}
			{@const open = expanded === item.id || active}
			{@const feedback = hostState.feedback?.[item.id]}
			{#key item.id}
				<AuthProviderItem
					{...{
						item,
						open,
						setExpanded,
						feedback,
						active,
						hostState,
						send,
					}}
				/>
			{/key}
		{/each}
	</ul>
	{#if filtered.length === 0}
		<p class="py-[24px] text-center text-muted">
			一致する認証先がありません。
		</p>
	{/if}
</main>
