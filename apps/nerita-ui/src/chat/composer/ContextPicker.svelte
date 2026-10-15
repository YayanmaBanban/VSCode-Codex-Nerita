<!-- コンテキストの候補一覧に最近使った参照と階層移動を加え、共通の補完メニューへ渡す。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import type { CompletionMenuProps } from "./completionMenuProps";
	import type { WorkspacePath } from "@nerita/shared/workspacePaths";
	import type { CompletionItem } from "./completionItems";
	import { referenceIcon } from "./referencePresentation";
	import CompletionMenu from "./CompletionMenu.svelte";
	import ContextPickerBreadcrumbs from "./ContextPickerBreadcrumbs.svelte";
	import SettingsTooltip from "../SettingsTooltip.svelte";

	let {
		recent,
		onCategories,
		ancestors,
		onAncestor,
		...props
	}: CompletionMenuProps & {
		recent: CompletionItem[];
		onCategories: () => void;
		ancestors: WorkspacePath[];
		onAncestor: (depth: number) => void;
	} = $props();
</script>

<CompletionMenu {...props} context>
	{#snippet header()}
		<div class="mb-2">
			<p class="m-0 mb-2 text-[12px] text-muted">最近使用</p>
			<div class="flex flex-wrap gap-1" aria-label="最近使用">
				{#each recent as item (JSON.stringify(item.reference))}
					{@const Icon = item.reference
						? referenceIcon(item.reference)
						: undefined}
					<SettingsTooltip content={item.description} aboveMenu
						>{#snippet children({ props: triggerProps })}<button
								{...triggerProps}
								type="button"
								onmousedown={(event) => event.preventDefault()}
								onclick={() => props.onPick(item)}
								class={cn(
									"inline-flex max-w-full items-center gap-1 rounded border border-solid border-panel-border",
									"bg-transparent px-2 py-1 text-[12px] text-input-text",
									"hover:bg-settings-hover",
									"focus-visible:outline-2 focus-visible:outline-focus",
								)}
								>{#if Icon}<Icon
										size={14}
										class="shrink-0"
										aria-hidden="true"
									/>{/if}<span class="truncate"
									>{item.label}</span
								></button
							>{/snippet}</SettingsTooltip
					>
				{/each}
				{#if recent.length === 0}<span class="text-[12px] text-muted"
						>まだありません</span
					>{/if}
			</div>
		</div>
		<hr
			class="m-0 mb-2 border-0 border-t border-solid border-panel-border"
		/>
		<ContextPickerBreadcrumbs
			title={props.title}
			{ancestors}
			{onCategories}
			{onAncestor}
		/>
	{/snippet}
</CompletionMenu>
