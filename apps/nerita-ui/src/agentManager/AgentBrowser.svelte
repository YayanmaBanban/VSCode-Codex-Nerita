<!-- エージェント一覧と編集欄を並べ、選択と未保存項目の表示を管理する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";

	let {
		agents,
		selected,
		onSelect,
		busy,
		defaults = false,
		children,
	}: {
		agents: ManagedAgent[];
		selected: string;
		onSelect: (id: string) => void;
		busy: boolean;
		defaults?: boolean;
		children: Snippet;
	} = $props();
	let items = $derived([
		...(defaults
			? [
					{
						id: "defaults",
						name: "Workspace defaults",
						description: "プロジェクト共通の設定",
					},
				]
			: []),
		...agents,
		...(selected === "new"
			? [{ id: "new", name: "新しい Agent", description: "未保存の定義" }]
			: []),
	]);
</script>

<div class="grid min-w-0 gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
	<aside
		class="min-w-0 border-b border-input-border pb-4 sm:border-r sm:border-b-0 sm:pr-4"
	>
		<h2 class="mt-0 mb-3 text-sm font-semibold">Agents</h2>
		<nav aria-label="Agents" class="grid gap-1">
			{#each items as item (item.id)}<SettingsTooltip
					content={item.description}
					>{#snippet children({ props })}<button
							{...mergeProps(
								{ ...props },
								{
									onclick: () => onSelect(item.id),
								},
							)}
							type="button"
							disabled={busy}
							aria-current={selected === item.id
								? "page"
								: undefined}
							class={cn(
								"flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm break-words",
								"hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus",
								selected === item.id && "bg-settings-hover",
							)}
							><span class="min-w-0 break-words">{item.name}</span
							>{#if selected === item.id}<ArrowRight
									size={16}
									class="shrink-0"
									aria-hidden="true"
								/>{/if}</button
						>{/snippet}</SettingsTooltip
				>{/each}
		</nav>
		{#if items.length === 0}<p class="text-sm text-muted">
				Agent 定義がありません。
			</p>{/if}
	</aside>
	<section class="min-w-0">{@render children()}</section>
</div>
