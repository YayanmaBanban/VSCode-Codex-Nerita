<script lang="ts">
	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";

	import { type useWorkflow } from "./useWorkflow.svelte";

	export type WorkflowEditorState = ReturnType<typeof useWorkflow>;
	let { editor }: { editor: WorkflowEditorState } = $props();
	let showScript = $state(false);
	const setShowScript = (change: (value: boolean) => boolean) => {
		showScript = change(showScript);
	};
	let script = $derived(editor.reply?.script);
	let notice = $derived(
		nonEmptyString(editor.reply?.notice) ??
			"定義を保存してから実行してください。",
	);
</script>

<footer class="shrink-0 border-t border-[var(--workflow-border)] p-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p role="status" class="min-w-0 flex-1 break-words">
			{editor.state?.running === true
				? "実行中 · 承認はチャットで操作してください。エディタを閉じると停止します。"
				: notice}
		</p>
		<button
			disabled={!isNonEmptyString(script)}
			onclick={() => setShowScript((value) => !value)}
			>生成スクリプト{showScript ? "を閉じる" : "を表示"}</button
		>
	</div>
	{#if showScript && isNonEmptyString(script)}
		<pre
			class={cn(
				"mt-3 max-h-48 overflow-auto rounded border",
				"border-[var(--workflow-border)] p-3 text-xs",
			)}>{script}</pre>
	{/if}
</footer>
