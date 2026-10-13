<!-- Phase の開閉によって会話の接続を再生成せず、承認・停止・履歴を共通部品で扱う。 -->
<script lang="ts">
	import type { Bridge } from "@nerita/shared/bridge";
	import type { useChat } from "../useChat.svelte";
	import type { DlcView } from "@nerita/shared/dlc/contracts";
	import ChatWorkspace from "../ChatWorkspace.svelte";
	import DlcRunInfo from "./DlcRunInfo.svelte";

	let { bridge, view }: { bridge: Bridge; view: DlcView } = $props();
</script>

<section
	aria-label="Worktree の会話"
	class="mt-4 h-[70vh] min-h-[360px] overflow-hidden rounded-lg border border-solid border-panel-border"
>
	<ChatWorkspace {bridge} managed>
		{#snippet header({
			chat,
		}: {
			chat: ReturnType<typeof useChat>;
		})}<DlcRunInfo
				{view}
				state={chat.state}
				send={chat.send}
			/>{#if chat.requestError !== null && chat.requestError !== view.error}<p
					role="alert"
					class="m-0 px-3 py-2 text-tool-error"
				>
					{chat.requestError}
				</p>{/if}{/snippet}
	</ChatWorkspace>
</section>
