<script lang="ts">
	// 通常チャットと DLC の表示先を組み立てる。
	import type { Bridge } from "@nerita/shared/bridge";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import ChatModeHeader from "./ChatModeHeader.svelte";
	import { useDlc } from "./dlc/useDlc.svelte";
	let { bridge }: { bridge: Bridge } = $props();
	const dlc = useDlc(() => bridge);
</script>

<main class="m-auto h-dvh min-h-[360px] max-w-[1350px]">
	<ChatWorkspace {bridge}>
		{#snippet header(props)}
			<ChatModeHeader {...props} mode={dlc.view.mode} />
		{/snippet}
	</ChatWorkspace>
</main>
