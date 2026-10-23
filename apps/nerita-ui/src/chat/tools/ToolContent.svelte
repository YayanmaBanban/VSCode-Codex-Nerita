<!-- ツールの差分・本文・入出力を安全な専用表示へ振り分ける。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import FileDiff from "./FileDiff.svelte";
	import UnifiedDiff from "./UnifiedDiff.svelte";
	import Value from "./Value.svelte";
	import RawTool from "./RawTool.svelte";
	import { toolLabelClass } from "./toolStyles";

	let {
		tool,
		scrollable = false,
		send,
		cwd,
	}: {
		tool: ToolSummary;
		scrollable?: boolean;
		send?: ((message: UiMessage) => void) | undefined;
		cwd?: string | null | undefined;
	} = $props();
	const hasContent = $derived((tool.content?.length ?? 0) > 0);
	const hasDetails = $derived(
		hasContent ||
			tool.rawInput !== undefined ||
			tool.rawOutput !== undefined,
	);
</script>

{#each tool.paths as path, index (index)}
	<div class={`tool-path ${toolLabelClass}`}>
		{path}
	</div>
{/each}
{#if tool.resultDisplay?.source === "structuredContent"}
	<div class={toolLabelClass}>構造化結果</div>
{/if}
{#each tool.content ?? [] as value, index (index)}
	{#if value.type === "unifiedDiff"}
		<UnifiedDiff
			path={value.path}
			diff={value.diff}
			{send}
			cwd={tool.cwd ?? cwd}
		/>
	{:else}
		{#if value.type === "diff"}
			<FileDiff
				path={value.path}
				oldText={value.oldText}
				newText={value.newText}
				{send}
				cwd={tool.cwd ?? cwd}
			/>
		{:else}
			{#if value.type === "content"}
				<Value value={value.content.text} {scrollable} />
			{:else}
				<Value {value} {scrollable} />
			{/if}
		{/if}
	{/if}
{/each}
{#if tool.rawInput !== undefined}
	<section>
		<h3 class={toolLabelClass}>入力</h3>
		<Value value={tool.rawInput} {scrollable} />
	</section>
{/if}
{#if tool.rawOutput !== undefined}
	<section>
		<h3 class={toolLabelClass}>出力</h3>
		<Value value={tool.rawOutput} {scrollable} />
	</section>
{/if}
{#if !hasDetails}
	<RawTool {tool} {scrollable} />
{/if}
