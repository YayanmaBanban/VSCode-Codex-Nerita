<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import Messages from "../../../src/chat/messages/Messages.svelte";
	import type { UiMessage } from "@nerita/shared/messages";
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import "../../../src/chat/chat.css";
	import { markdown } from "./MarkdownData";

	let streaming = $state.raw(false);
	function setStreaming(
		value:
			| typeof streaming
			| ((current: typeof streaming) => typeof streaming),
	) {
		streaming = typeof value === "function" ? value(streaming) : value;
	}
	let opened = $state.raw("");
	function setOpened(
		value: typeof opened | ((current: typeof opened) => typeof opened),
	) {
		opened = typeof value === "function" ? value(opened) : value;
	}
</script>

<main class="p-[14px]">
	<button onclick={() => setStreaming(true)}>途中の本文</button>
	<button onclick={() => setStreaming(false)}>本文完了</button>
	<output hidden aria-label="開いたファイル"> {opened} </output>
	<Messages
		send={(message: UiMessage) => {
			if (message.type === "reference/open") {
				setOpened(message.uri);
			}
		}}
		busy={streaming}
		messages={[
			{
				id: "user",
				role: "user",
				text: "**Markdown**で説明してください。",
				order: 0,
			},
			{
				id: "answer",
				role: "assistant",
				text: streaming
					? "## 書き込み中\n\n```ts\nconst partial = true;"
					: markdown,
				streaming,
				order: 1,
			},
		]}
		tools={[
			{
				id: "raw",
				title: "未対応ツール",
				status: "in_progress",
				paths: [],
				rawOutput: { text: "**これはJSONのまま**" },
				order: 2,
			},
		]}
		>{#snippet renderTool(tool)}<ToolCard {tool}
			></ToolCard>{/snippet}</Messages
	>
</main>
