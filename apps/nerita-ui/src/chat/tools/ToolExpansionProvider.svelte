<!-- 会話専用のカード開閉状態と出力取得 Bridge を子の UI に渡す。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import {
		provideToolExpansion,
		provideToolOutputBridge,
		type ToolExpansionState,
	} from "./ToolExpansion.svelte";

	let {
		expansion,
		bridge,
		children,
	}: {
		expansion: ToolExpansionState;
		bridge?: Bridge | undefined;
		children: Snippet;
	} = $props();
	provideToolExpansion({
		get open() {
			return expansion.open;
		},
		setOpen: (tool, open) => expansion.setOpen(tool, open),
	});
	provideToolOutputBridge(() => bridge);
</script>

{@render children()}
