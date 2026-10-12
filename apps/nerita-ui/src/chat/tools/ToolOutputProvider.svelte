<!-- 単独カードのストーリーや画面へ出力取得 Bridge を渡す。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import { provideToolOutputBridge } from "./ToolExpansion.svelte";
	let { value, children }: { value: Bridge; children: Snippet } = $props();
	provideToolOutputBridge(() => value);
</script>

{@render children()}
