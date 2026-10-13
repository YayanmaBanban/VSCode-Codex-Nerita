<script lang="ts">
	import ChatApp from "../StoryChat.svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import type { ComposerPart } from "@nerita/shared/composerContent";
	import { pathText } from "@nerita/shared/composerReferences";
	import { createChatStoryBridge } from "../mocks/mockBridge";

	let opened = $state.raw("");
	const setOpened = (
		value: typeof opened | ((previous: typeof opened) => typeof opened),
	) => {
		opened = typeof value === "function" ? value(opened) : value;
	};
	const bridge = (() => {
		const mock = createChatStoryBridge();
		const file = {
			uri: "file:///D:/workspace/日本語%20sample.md",
			name: "日本語 sample.md",
			path: "D:\\workspace\\日本語 sample.md",
			kind: "file" as const,
		};
		const folder = {
			uri: "file:///D:/workspace/src",
			name: "src",
			path: "D:\\workspace\\src",
			kind: "directory" as const,
		};
		const prefix = `前文${pathText(file)} と `;
		const parts: ComposerPart[] = [
			{
				id: "references",
				type: "text",
				text: `${prefix}${pathText(folder)} 後文`,
				references: [
					{ offset: 2, path: file },
					{ offset: prefix.length, path: folder },
				],
			},
		];

		const restore = () =>
			mock.emit({
				type: "ui/viewState",
				editor: false,
				draft: parts.map((part) => part.text).join(""),
				draftParts: parts,
				scrollTop: 0,
				restoreScroll: true,
			});
		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "reference/open") {
					setOpened(message.uri);
					return;
				}
				mock.postMessage(message);
				if (message.type === "ui/ready") {
					restore();
				}
			},
		} satisfies Bridge;
	})();
</script>

<ChatApp {bridge} /><output aria-label="開いた参照">{opened}</output>
