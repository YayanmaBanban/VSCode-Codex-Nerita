<script lang="ts">
	import ChatApp from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";

	let { mode, reviewer }: { mode?: string; reviewer?: string } = $props();
	const bridge = $derived(createPlanBridge(mode, reviewer));
	function createPlanBridge(
		_mode: string | undefined,
		_reviewer: string | undefined,
	) {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			messages: [
				{
					id: "proposed-plan",
					role: "assistant",
					streaming: false,
					text: "## 認証機能の実装計画\n\n1. 既存の認証経路を調査する。\n2. セッション管理とエラー処理を実装する。\n3. 回帰テストを追加して検証する。",
				},
			],
		});
		return mock;
	}
</script>

<ChatApp {bridge} />
