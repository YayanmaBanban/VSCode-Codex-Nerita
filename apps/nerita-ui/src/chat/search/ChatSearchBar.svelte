<!-- 会話専用の検索語・一致条件・前後移動を表示する。 -->
<script lang="ts">
	import ChevronLeft from "@lucide/svelte/icons/chevron-left";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import X from "@lucide/svelte/icons/x";
	import { mergeProps } from "bits-ui";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import type { ChatSearch } from "./useChatSearch.svelte";
	import "./chatSearch.css";

	let { search }: { search: ChatSearch } = $props();
	const buttonClass =
		"chat-search-button inline-grid h-6 w-[22px] shrink-0 place-items-center rounded-[3px] border border-solid border-transparent bg-transparent p-0 text-[12px]";
	const optionButtons = [
		["caseSensitive", "大文字と小文字を区別", "Aa"],
		["wholeWord", "単語単位", "ab"],
		["regex", "正規表現", ".*"],
	] as const;
	const counter = $derived(
		`${search.result.count > 0 ? search.result.index + 1 : 0}/${search.result.count}${search.result.limited ? "+" : ""}`,
	);
	/** Escape は各操作から閉じ、入力欄の Enter だけ一致移動に使う。 */
	function handleSearchKey(event: KeyboardEvent) {
		if (event.isComposing) {
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			search.close();
		}
		if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
			event.preventDefault();
			search.move(event.shiftKey ? -1 : 1);
		}
	}
</script>

{#if search.open}
	<div
		class="chat-search shrink-0 border-0 border-b border-solid border-panel-border bg-menu px-2 py-1"
	>
		<form
			role="search"
			aria-label="会話内検索"
			class="flex min-w-0 items-center gap-1"
			onsubmit={(event) => event.preventDefault()}
		>
			<div
				class="flex min-w-0 flex-1 items-center rounded border border-solid border-input-border bg-input focus-within:border-focus"
			>
				<input
					{@attach (element: HTMLInputElement) => {
						search.setInput(element);
						return () => search.setInput(null);
					}}
					aria-label="会話を検索"
					aria-invalid={search.result.error !== ""}
					title="会話を検索 (Ctrl+F)"
					class="w-full min-w-0 border-0 bg-transparent px-2 py-1 text-[12px] text-input-text outline-none"
					placeholder="検索"
					autocomplete="off"
					spellcheck={false}
					value={search.query}
					oninput={(event) =>
						search.setQuery(event.currentTarget.value)}
					onkeydown={handleSearchKey}
				/>
				{#each optionButtons as [key, label, icon] (key)}<SettingsTooltip
						content={label}
						>{#snippet children({ props })}<button
								{...mergeProps(props, {
									onclick: () =>
										search.setOptions({
											...search.options,
											[key]: !search.options[key],
										}),
									onkeydown: handleSearchKey,
								})}
								type="button"
								class={`${buttonClass} ${key === "wholeWord" ? "underline underline-offset-2" : ""}`}
								aria-label={label}
								aria-pressed={search.options[key]}
								>{icon}</button
							>{/snippet}</SettingsTooltip
					>{/each}
			</div>
			<SettingsTooltip content="前の一致 (Shift+Enter)"
				>{#snippet children({ props })}<button
						{...mergeProps(props, {
							onclick: () => search.move(-1),
							onkeydown: handleSearchKey,
						})}
						type="button"
						class={buttonClass}
						aria-label="前の一致"
						disabled={search.result.count === 0}
						><ChevronLeft size={14} /></button
					>{/snippet}</SettingsTooltip
			>
			<SettingsTooltip content="次の一致 (Enter)"
				>{#snippet children({ props })}<button
						{...mergeProps(props, {
							onclick: () => search.move(1),
							onkeydown: handleSearchKey,
						})}
						type="button"
						class={buttonClass}
						aria-label="次の一致"
						disabled={search.result.count === 0}
						><ChevronRight size={14} /></button
					>{/snippet}</SettingsTooltip
			>
			<output
				aria-label="検索結果"
				aria-live="polite"
				class="shrink-0 text-[12px] whitespace-nowrap tabular-nums"
				>{counter}</output
			>
			<SettingsTooltip content="閉じる (Escape)"
				>{#snippet children({ props })}<button
						{...mergeProps(props, {
							onclick: search.close,
							onkeydown: handleSearchKey,
						})}
						type="button"
						class={buttonClass}
						aria-label="検索を閉じる"><X size={14} /></button
					>{/snippet}</SettingsTooltip
			>
		</form>
		{#if search.result.error}<p
				role="alert"
				class="my-1 text-[12px] text-tool-error"
			>
				{search.result.error}
			</p>{/if}
	</div>
{/if}
