<!-- 製品のチャット画面に質問を表示し、通信をモックで再現する。 -->
<script lang="ts">
	import { initialState } from "@nerita/shared/chatState";
	import type { QuestionRequest } from "@nerita/shared/questions";
	import StoryChat from "./StoryChat.svelte";
	import { createStoryBridge } from "./mocks/storyBridge";

	let { question }: { question: QuestionRequest } = $props();
	const bridge = $derived(
		createStoryBridge({
			...initialState(),
			connection: "ready",
			sessionId: question.sessionId,
			runId: question.runId,
			run: "running",
			messages: [
				{
					id: "request",
					role: "user",
					text: "作業を始める前に、必要な点を確認してください。",
				},
			],
			questions: [question],
		}),
	);
</script>

<StoryChat {bridge} />
