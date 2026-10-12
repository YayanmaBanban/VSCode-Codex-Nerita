<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { timelineMessages } from "./fixtures/timeline";
	import ChatApp from "./StoryChat.svelte";
	import { createChatStoryBridge } from "./mocks/mockBridge";
	const bridge = (() => {
		const bridge = createChatStoryBridge();
		bridge.patchState({
			run: "completed",
			runId: "previous",
			messages: timelineMessages(),
			tools: [
				{
					id: "cmd",
					runId: "previous",
					order: 3,
					kind: "execute",
					title: "pnpm.cmd test",
					status: "completed",
					paths: [],
					rawInput: {
						cwd: "D:/workspace/project",
						command: "pnpm.cmd test",
					},
					rawOutput: { formatted_output: "✓ All tests passed" },
				},
			],
		});
		return bridge;
	})();
</script>

<ChatApp {bridge}></ChatApp>
