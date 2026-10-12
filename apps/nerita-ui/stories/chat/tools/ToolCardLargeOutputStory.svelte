<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { initialState } from "@nerita/shared/chatState";
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import ToolOutputBridge from "../../../src/chat/tools/ToolOutputProvider.svelte";
	import { createStoryBridge } from "../mocks/storyBridge";
	import "../../../src/chat/chat.css";
	let completed = $state.raw(false);
	function setCompleted(
		value:
			| typeof completed
			| ((current: typeof completed) => typeof completed),
	) {
		completed = typeof value === "function" ? value(completed) : value;
	}
	const bridge = createStoryBridge(initialState());
</script>

<main style:padding="16px">
	<button onclick={() => setCompleted(true)}>完了通知を受信</button>
	<button
		onclick={() => {
			const request = [...bridge.sent]
				.reverse()
				.find((message) => message.type === "tool/output");
			if (request?.type !== "tool/output") {
				return;
			}
			bridge.emit({
				type: "tool/outputResult",
				requestId: request.requestId,
				outputRef: request.outputRef,
				text:
					request.offset === 0
						? "先頭の詳細出力\n日本語と絵文字 🐈\n".repeat(1000)
						: "次の詳細出力\nFAIL: 末尾エラー",
				offset: request.offset,
				nextOffset: request.offset === 0 ? 65535 : 65600,
				eof: request.offset !== 0,
			});
		}}
	>
		出力応答を受信
	</button>
	<ToolOutputBridge value={bridge}>
		<ToolCard
			tool={{
				id: "large",
				kind: "execute",
				title: "Get-Content ./logs/very-long-directory-name/large-output-with-japanese-text.log",
				cwd: "./workspace/project",
				paths: [],
				status: completed ? "completed" : "in_progress",
				output: {
					preview:
						"出力開始\nChecking types...\n\n… 18,420文字を省略 …\n\nFAIL: 末尾エラー",
					truncated: true,
					outputRef: "large-output",
					totalBytes: 1600000,
				},
			}}
		></ToolCard>
	</ToolOutputBridge>
</main>
