<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { initialState } from "@nerita/shared/chatState";
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import ToolOutputBridge from "../../../src/chat/tools/ToolOutputProvider.svelte";
	import { createStoryBridge } from "../mocks/storyBridge";
	import { respondToolOutput } from "./ToolCardData";
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
	/** ストーリーの描画要素に応答注入用の通信窓口を公開する。 */
	function attachBridge(element: HTMLElement) {
		Object.assign(element, { storyBridge: bridge });
		return () => {
			Reflect.deleteProperty(element, "storyBridge");
		};
	}
</script>

<main style:padding="16px" data-story-chat {@attach attachBridge}>
	<button onclick={() => respondToolOutput(bridge, true)}
		>出力取得を失敗</button
	>
	<button onclick={() => setCompleted(true)}>完了通知を受信</button>
	<button onclick={() => respondToolOutput(bridge)}>出力応答を受信</button>
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
