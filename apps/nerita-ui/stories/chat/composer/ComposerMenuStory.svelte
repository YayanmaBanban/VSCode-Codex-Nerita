<script lang="ts">
	import type { UiMessage } from "@nerita/shared/messages";
	import ChatApp from "../StoryChat.svelte";

	import { createChatStoryBridge } from "../mocks/mockBridge";

	let sent = $state.raw("");
	const setSent = (
		value: typeof sent | ((previous: typeof sent) => typeof sent),
	) => {
		sent = typeof value === "function" ? value(sent) : value;
	};
	const bridge = (() => {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			attachments: [
				{
					id: "a",
					name: "alpha.ts",
					uri: "file:///D:/workspace/alpha.ts",
				},
				{
					id: "b",
					name: "日本語 sample.md",
					uri: "file:///D:/workspace/sample.md",
				},
			],
			skills: [
				{
					name: "review",
					description: "コードを確認する",
					path: "D:/skills/review/SKILL.md",
				},
				{
					name: "test",
					description: "テストを実行する",
					path: "D:/skills/test/SKILL.md",
				},
			],
		});
		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message: UiMessage) {
				if (message.type === "prompt/send") {
					setSent(message.text);
				}
				mock.postMessage(message);
			},
		};
	})();
</script>

<ChatApp {bridge} /><output hidden aria-label="送信した本文">{sent}</output>
