<!-- 通常チャットと DLC の表示先を組み立てる。 -->
<script lang="ts">
	import type { Bridge } from "@nerita/shared/bridge";
	import ChatWorkspace from "./ChatWorkspace.svelte";
	import ChatModeHeader from "./ChatModeHeader.svelte";
	import { useDlc } from "./dlc/useDlc.svelte";

	let { bridge }: { bridge: Bridge } = $props();
	const dlc = useDlc(() => bridge);
</script>

<main class="h-dvh min-h-[360px] w-full">
	<ChatWorkspace {bridge}>
		{#snippet header(props)}
			<ChatModeHeader {...props} mode={dlc.view.mode} />
		{/snippet}
	</ChatWorkspace>
</main>
