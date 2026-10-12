<!-- 一つの差分ブロックを行番号付きで表示し、長い行をキーボードでスクロールする。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		hunkPresentation,
		changeCount,
		type DiffHunk,
	} from "./diffPresentation";
	import { diffLineClass, toolCodeClass } from "./toolStyles";
	let { hunk }: { hunk: DiffHunk } = $props();
	const presentation = $derived(hunkPresentation(hunk));
	const changed = $derived(changeCount(hunk.lines));
	// Svelte の空白圧縮に左右されず、コードの余白と改行を保持する。
	const numberGap = "  ";
	const lineBreak = "\n";
</script>

<div
	class="file-diff-block my-[8px] overflow-hidden rounded-[4px] border border-solid border-panel-border"
>
	<div
		class="file-diff-hunk flex items-center justify-between gap-[12px] bg-diff-hunk px-[8px] py-[4px] font-editor text-[12px] text-muted"
	>
		<span>{presentation.range}</span><span
			class="inline-flex shrink-0 gap-[8px] font-editor tabular-nums"
			aria-label={`${changed.added} 行追加、${changed.removed} 行削除`}
			><span class="text-menu-check">+{changed.added}</span><span
				class="text-tool-error">-{changed.removed}</span
			></span
		>
	</div>
	<div
		role="region"
		aria-label={`${presentation.range} の差分コード`}
		class="overflow-x-auto"
	>
		<pre
			class={cn(
				"file-diff-lines",
				toolCodeClass,
				"m-0 [overflow-wrap:normal] whitespace-pre",
			)}>{#each presentation.numbered as { line, number }, lineIndex (lineIndex)}<span
					class={cn(
						diffLineClass,
						line.startsWith("+") && "file-diff-added bg-diff-added",
						line.startsWith("-") &&
							"file-diff-removed bg-diff-removed",
					)}
					><span class="text-muted select-none"
						>{String(number ?? "").padStart(
							presentation.digits,
						)}{numberGap}</span
					>{line[0]}{line[0] === "\\" ? "" : " "}{line.slice(
						1,
					)}{lineBreak}</span
				>{/each}</pre>
	</div>
</div>
