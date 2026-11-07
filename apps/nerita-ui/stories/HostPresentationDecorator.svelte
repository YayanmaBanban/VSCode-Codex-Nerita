<!-- 起動環境の表示情報だけを差し替え、UI の判定や保存処理は本体に任せる。 -->
<script lang="ts">
	import { setContext, untrack, type Snippet } from "svelte";
	import type { HostPresentation } from "@nerita/shared/hostPresentation";
	import { hostPresentationKey } from "../src/ui/hostPresentation";

	let {
		presentation,
		children,
	}: { presentation: HostPresentation; children: Snippet } = $props();
	setContext(
		hostPresentationKey,
		untrack(() => presentation),
	);
</script>

{@render children()}
