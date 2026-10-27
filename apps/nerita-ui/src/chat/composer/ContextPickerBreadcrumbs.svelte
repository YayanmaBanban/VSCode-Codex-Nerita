<!-- コンテキストの選択階層をパンくずで示し、カテゴリーや親ディレクトリへ戻る操作を提供する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import type { WorkspacePath } from "@nerita/shared/workspacePaths";

	let {
		title,
		ancestors,
		onCategories,
		onAncestor,
	}: {
		title: string;
		ancestors: WorkspacePath[];
		onCategories: () => void;
		onAncestor: (depth: number) => void;
	} = $props();
	let crumbs = $derived.by(() => {
		const items = [
			{ key: "root", label: "コンテキストを追加", onClick: onCategories },
		];
		if (title !== "コンテキスト") {
			items.push({
				key: "category",
				label: title,
				onClick: () => onAncestor(0),
			});
		}
		if (title === "ファイルとディレクトリ") {
			items.push(
				...ancestors.map((entry, index) => ({
					key: entry.uri,
					label: entry.name,
					onClick: () => onAncestor(index + 1),
				})),
			);
		}
		return items;
	});
</script>

<nav aria-label="コンテキストの階層" class="mb-1 min-w-0">
	<ol class="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-[12px]">
		{#each crumbs as crumb, index (crumb.key)}
			<li class="flex max-w-full min-w-0 items-center gap-1">
				{#if index > 0}
					<ChevronRight
						size={12}
						class="shrink-0 text-muted"
						aria-hidden="true"
					/>
				{/if}
				{#if index === crumbs.length - 1}
					<span
						aria-current="location"
						class="min-w-0 px-1 py-2 break-all text-input-text"
					>
						{crumb.label}
					</span>
				{:else}
					<button
						type="button"
						onmousedown={(event) => event.preventDefault()}
						onclick={crumb.onClick}
						class={cn(
							"min-w-0 rounded border-0 bg-transparent px-1 py-2 text-left break-all text-muted",
							"hover:bg-settings-hover hover:text-input-text",
							"focus-visible:outline-2 focus-visible:outline-focus",
						)}
					>
						{crumb.label}
					</button>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
