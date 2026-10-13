<!-- 受信した unified diff を再計算せず表示し、解析できない本文も残す。 -->
<script lang="ts">
	import { parsePatch } from "diff";
	import DiffView from "./DiffView.svelte";
	import type { DiffLocationProps } from "./diffPresentation";
	import { toolOutputClass } from "./toolStyles";

	let { diff, ...location }: DiffLocationProps & { diff: string } = $props();
	const hunks = $derived.by(() => {
		try {
			return parsePatch(diff).flatMap((patch) => patch.hunks);
		} catch {
			return [];
		}
	});
</script>

<DiffView {...location} hunks={hunks.length > 0 ? hunks : undefined}
	>{#if hunks.length === 0}<pre
			class={toolOutputClass}>{diff}</pre>{/if}</DiffView
>
