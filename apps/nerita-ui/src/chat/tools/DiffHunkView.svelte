<!-- 1つの差分ブロックを行番号付きで表示し、長い行をキーボードでスクロールする。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		hunkPresentation,
		changeCount,
		type DiffHunk,
		type DiffLocationProps,
	} from "./diffPresentation";
	import { diffLineClass, toolCodeClass } from "./toolStyles";
	import DiffFileButton from "./DiffFileButton.svelte";
	import ChangeCount from "./ChangeCount.svelte";

	let { hunk, ...location }: DiffLocationProps & { hunk: DiffHunk } =
		$props();
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
		class="file-diff-hunk flex min-w-0 items-center gap-[8px] bg-diff-hunk px-[8px] py-[4px] font-editor text-[12px] text-muted"
	>
		<DiffFileButton {...location} range={presentation.range} />
		<ChangeCount {...changed} />
	</div>
	<div
		role="region"
		aria-label={`${presentation.range} の差分コード`}
		class="max-h-[400px] overflow-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
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
					)}><span class="text-muted select-none">{String(
							number ?? "",
						).padStart(
							presentation.digits,
						)}{numberGap}</span>{line[0]}{line[0] === "\\"
						? ""
						: " "}{line.slice(1)}{lineBreak}</span>{/each}</pre>
	</div>
</div>
