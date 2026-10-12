<script lang="ts">
	type Setter<T> = (value: T | ((previous: T) => T)) => void;
	import type { Bridge } from "@nerita/shared/bridge";
	import ChatApp from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";
	import { type ChatState } from "@nerita/shared/chatState";
	import { type UiMessage, type HostMessage } from "@nerita/shared/messages";

	/** コピーしたコードの照合結果を遅延通知する。 */
	function createCopiedCodeReply(
		mock: {
			patchState(patch: Partial<ChatState>): void;
			postMessage(
				message: Parameters<(message: UiMessage) => void>[0],
			): void;
			subscribe: (listener: (message: HostMessage) => void) => () => void;
			sent: UiMessage[];
			emit(message: HostMessage): void;
		},
		message: {
			type: "workspace/resolveCode";
			requestId: string;
			text: string;
		},
		setResolved: Setter<number>,
	): () => void {
		return () => {
			mock.emit({
				type: "workspace/resolvedPath",
				requestId: message.requestId,
				entry: message.text.startsWith("let controller:")
					? {
							uri: "file:///D:/workspace/project/src/extension.ts",
							path: "D:\\workspace\\project\\src\\extension.ts",
							name: "extension.ts",
							kind: "file",
							range: {
								start: {
									line: 8,
									character: 0,
								},
								end: {
									line: 11,
									character: 40,
								},
							},
						}
					: null,
			});
			setResolved((previous) => previous + 1);
		};
	}
	let opened = $state.raw("");
	const setOpened = (
		value: typeof opened | ((previous: typeof opened) => typeof opened),
	) => {
		opened = typeof value === "function" ? value(opened) : value;
	};
	let sent = $state.raw("");
	const setSent = (
		value: typeof sent | ((previous: typeof sent) => typeof sent),
	) => {
		sent = typeof value === "function" ? value(sent) : value;
	};
	let resolved = $state.raw(0);
	const setResolved = (
		value:
			typeof resolved | ((previous: typeof resolved) => typeof resolved),
	) => {
		resolved = typeof value === "function" ? value(resolved) : value;
	};
	const bridge = (() => {
		const mock = createChatStoryBridge("empty");
		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "workspace/resolveCode") {
					setTimeout(
						createCopiedCodeReply(mock, message, setResolved),
						100,
					);
					return;
				}
				if (message.type === "reference/open") {
					setOpened(JSON.stringify(message));
					return;
				}
				if (message.type === "prompt/send") {
					setSent(JSON.stringify(message));
				}
				mock.postMessage(message);
			},
		} satisfies Bridge;
	})();
</script>

<ChatApp {bridge} /><output hidden aria-label="照合完了数">{resolved}</output
><output hidden aria-label="開いたコード">{opened}</output><output
	hidden
	aria-label="送信した参照">{sent}</output
>
