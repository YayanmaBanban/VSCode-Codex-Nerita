<!-- ワークフロー文書の操作エラーを表示し、入力を破棄して再読み込みする操作を提供する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";

	let {
		error,
		reload,
	}: { error: string | null | undefined; reload: () => void } = $props();
</script>

{#if isNonEmptyString(error)}
	<div
		role="alert"
		class={cn(
			"shrink-0 overflow-auto border-b border-[var(--workflow-border)] p-3",
			"text-tool-error",
		)}
	>
		<p class="max-h-24 overflow-auto break-words whitespace-pre-wrap">
			{error}
		</p>
		<button onclick={reload}>文書を再読み込み（入力を破棄）</button>
	</div>
{/if}
