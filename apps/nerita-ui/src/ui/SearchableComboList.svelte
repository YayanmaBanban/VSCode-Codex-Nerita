<!-- 検索付きの候補一覧とキーボード選択を共有し、選択欄と検索アイコンの両方から開けるようにする。 -->
<script module lang="ts">
	/** value は候補内で一意にする。説明も検索対象とし、表示名と送信値を分けて扱う。 */
	export type SearchableComboOption = {
		value: string;
		name: string;
		description?: string | undefined;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import { Popover } from "bits-ui";
	import Search from "@lucide/svelte/icons/search";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { cn } from "cnfast";
	import Tooltip from "./Tooltip.svelte";

	let {
		label,
		options,
		value,
		onChange,
		disabled = false,
		appearance = "field",
		query = $bindable(""),
		side = "bottom",
		emptyMessage = "一致する項目がありません。",
	}: {
		label: string;
		options: SearchableComboOption[];
		value: string;
		onChange: (value: string) => void;
		disabled?: boolean;
		appearance?: "field" | "icon";
		query?: string;
		side?: "bottom" | "top" | "right" | "left";
		emptyMessage?: string;
	} = $props();
	let open = $state(false);
	let panel = $state<HTMLDivElement | null>(null);
	let search: HTMLInputElement | null = null;
	const listId = $props.id();
	let current = $derived(options.find((option) => option.value === value));
	let showSearch = $derived(options.length >= 5);
	let filtered = $derived(
		showSearch
			? options.filter((option) =>
					`${option.value} ${option.name} ${option.description ?? ""}`
						.toLowerCase()
						.includes(query.trim().toLowerCase()),
				)
			: options,
	);
	let triggerDisabled = $derived(
		disabled || (appearance === "field" && options.length === 0),
	);

	/** 選択欄は開くたびに全候補へ戻し、サイドバーの検索アイコンでは共有した検索条件を維持する。 */
	function changeOpen(next: boolean) {
		if (next && appearance === "field") {
			query = "";
		}
	}
	/** 無効な候補を選択させず、値が変わった場合だけ利用側へ通知する。 */
	function select(next: string) {
		const option = options.find((item) => item.value === next);
		if (disabled || option === undefined || option.disabled === true) {
			return;
		}
		if (next !== value) {
			onChange(next);
		}
		open = false;
	}
	/** 少数の候補では現在値か先頭候補へ移り、検索欄がある場合は入力から始める。 */
	function focusPanel(event: Event) {
		event.preventDefault();
		if (showSearch) {
			search?.focus({ preventScroll: true });
			return;
		}
		const buttons = [
			...(panel?.querySelectorAll<HTMLButtonElement>(
				"[data-combo-option]:not(:disabled)",
			) ?? []),
		];
		const target =
			buttons.find((button) => button.dataset.value === value) ??
			buttons[0] ??
			panel;
		target?.focus({ preventScroll: true });
	}
	/** 検索欄の寿命に合わせて参照を保持し、閉じたパネルの要素を次の操作へ持ち越さない。 */
	function attachSearch(node: HTMLInputElement) {
		search = node;
		return () => {
			if (search === node) {
				search = null;
			}
		};
	}
	/** 検索欄と候補の間を矢印で移動し、Enter では表示中の候補を選択する。 */
	function keydown(event: KeyboardEvent) {
		if (event.isComposing) {
			return;
		}
		if (!["Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
			return;
		}
		const buttons = [
			...(panel?.querySelectorAll<HTMLButtonElement>(
				"[data-combo-option]:not(:disabled)",
			) ?? []),
		];
		if (event.key === "Enter" && event.target === search) {
			event.preventDefault();
			(
				buttons.find((button) => button.dataset.value === value) ??
				buttons[0]
			)?.click();
			return;
		}
		moveFocus(event, buttons);
	}
	/** 候補の先頭と末尾を循環し、無効な候補にはフォーカスを移さない。 */
	function moveFocus(event: KeyboardEvent, buttons: HTMLButtonElement[]) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}
		event.preventDefault();
		if (buttons.length === 0) {
			return;
		}
		const down = event.key === "ArrowDown";
		let index = buttons.findIndex((button) => button === event.target);
		if (index < 0) {
			index = down ? -1 : 0;
		}
		buttons[
			(index + (down ? 1 : -1) + buttons.length) % buttons.length
		]?.focus();
	}
	/** 選択欄でも検索アイコンでも、矢印キーから検索を開始できるようにする。 */
	function openOnArrow(event: KeyboardEvent) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}
		if (triggerDisabled) {
			return;
		}
		event.preventDefault();
		changeOpen(true);
		open = true;
	}
</script>

<Popover.Root bind:open onOpenChange={changeOpen}>
	<Tooltip
		content={appearance === "icon" ? "検索" : ""}
		disabled={open || appearance === "field"}
		aboveMenu
	>
		{#snippet children({ props })}
			<Popover.Trigger
				{...props}
				disabled={triggerDisabled}
				role={appearance === "field" ? "combobox" : undefined}
				aria-label={appearance === "field" ? label : "検索"}
				onkeydown={openOnArrow}
				class={cn(
					"inline-flex min-w-0 shrink-0 items-center rounded",
					"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover disabled:opacity-50",
					appearance === "field"
						? "h-[38px] w-full justify-between gap-2 border border-input-border bg-transparent px-3 text-left text-[12px] text-primary-text"
						: "size-8 justify-center border-0 bg-transparent p-0 text-muted",
				)}
			>
				{#if appearance === "icon"}
					<Search size={16} aria-hidden="true" />
				{:else}<span class="min-w-0 truncate"
						>{current?.name ?? label}</span
					><ChevronDown
						size={12}
						class="shrink-0"
						aria-hidden="true"
					/>{/if}
			</Popover.Trigger>
		{/snippet}
	</Tooltip>
	<Popover.Portal>
		<Popover.Content
			bind:ref={panel}
			role="dialog"
			aria-label={`${label}を検索`}
			{side}
			align="start"
			sideOffset={8}
			collisionPadding={12}
			onOpenAutoFocus={focusPanel}
			onkeydown={keydown}
			class={cn(
				"z-50 flex max-h-[min(360px,var(--bits-popover-content-available-height))] min-w-0 flex-col gap-2",
				appearance === "field"
					? "box-border w-[min(var(--bits-popover-anchor-width),calc(100vw-24px))]"
					: "w-[min(300px,calc(100vw-24px))]",
				"rounded-lg border border-menu-border bg-menu p-3 text-menu-text shadow-xl",
			)}
		>
			{#if showSearch}
				<input
					{@attach attachSearch}
					type="search"
					{disabled}
					aria-label={`${label}を検索`}
					placeholder={`${label}を検索`}
					aria-controls={listId}
					bind:value={query}
					class={cn(
						"box-border w-full shrink-0 rounded border border-input-border bg-input px-3 py-2 text-sm text-input-text",
						"outline-none focus-visible:ring-2 focus-visible:ring-focus",
					)}
				/>
			{/if}
			<div
				id={listId}
				role={appearance === "field" ? "listbox" : "region"}
				aria-label={`${label}一覧`}
				class="grid min-h-0 gap-1 overflow-x-hidden overflow-y-auto overscroll-contain"
			>
				{#each filtered as option (option.value)}
					<button
						type="button"
						disabled={disabled || option.disabled === true}
						data-combo-option
						data-value={option.value}
						role={appearance === "field" ? "option" : undefined}
						aria-selected={appearance === "field"
							? value === option.value
							: undefined}
						aria-current={appearance === "icon" &&
						value === option.value
							? "page"
							: undefined}
						onclick={() => select(option.value)}
						class={cn(
							"min-w-0 rounded border-0 bg-transparent px-2 py-2 text-left text-sm [overflow-wrap:anywhere] text-primary-text",
							"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus enabled:hover:bg-settings-hover disabled:opacity-50",
							value === option.value &&
								"bg-settings-hover font-semibold",
						)}
					>
						{option.name}
					</button>
				{/each}
				{#if filtered.length === 0}
					<p class="m-0 px-2 py-2 text-sm text-muted">
						{emptyMessage}
					</p>
				{/if}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
