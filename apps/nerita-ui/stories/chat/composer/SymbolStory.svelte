<script lang="ts">
	let { pending = false }: { pending?: boolean } = $props();
	type Setter<T> = (value: T | ((previous: T) => T)) => void;
	import type { Bridge } from "@nerita/shared/bridge";
	import ChatApp from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";
	import { mockWorkspaceSymbols } from "../mocks/mockWorkspaceSymbols";
	import { type ChatState } from "@nerita/shared/chatState";
	import { type UiMessage, type HostMessage } from "@nerita/shared/messages";
	import { type WorkspaceSymbolsRequest } from "@nerita/shared/workspaceSymbols";

	/** 検索の完了を遅延通知して旧結果との競合を再現する。 */
	function createSymbolReply(
		mock: {
			patchState(patch: Partial<ChatState>): void;
			postMessage(
				message: Parameters<(message: UiMessage) => void>[0],
			): void;
			subscribe: (listener: (message: HostMessage) => void) => () => void;
			sent: UiMessage[];
			emit(message: HostMessage): void;
		},
		message: WorkspaceSymbolsRequest,
		setCompleted: Setter<string[]>,
	): () => void {
		return () => {
			if (message.query === "failed-request") {
				mock.emit({
					type: "request/failed",
					requestId: message.requestId,
					error: "Host search failed",
				});
			} else {
				mock.emit(mockWorkspaceSymbols(message));
			}
			setCompleted((previous) => [...previous, message.query]);
		};
	}
	let sent = $state.raw("");
	const setSent = (
		value: typeof sent | ((previous: typeof sent) => typeof sent),
	) => {
		sent = typeof value === "function" ? value(sent) : value;
	};
	let opened = $state.raw("");
	const setOpened = (
		value: typeof opened | ((previous: typeof opened) => typeof opened),
	) => {
		opened = typeof value === "function" ? value(opened) : value;
	};
	let queries = $state.raw<string[]>([]);
	const setQueries = (
		value: typeof queries | ((previous: typeof queries) => typeof queries),
	) => {
		queries = typeof value === "function" ? value(queries) : value;
	};
	let completed = $state.raw<string[]>([]);
	const setCompleted = (
		value:
			| typeof completed
			| ((previous: typeof completed) => typeof completed),
	) => {
		completed = typeof value === "function" ? value(completed) : value;
	};
	const bridge = (() => {
		const mock = createChatStoryBridge("empty");
		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "prompt/send") {
					setSent(message.text);
				}
				if (message.type === "reference/open") {
					setOpened(JSON.stringify(message));
					return;
				}
				if (message.type === "workspace/searchSymbols") {
					setQueries((previous) => [...previous, message.query]);
					if (pending) {
						return;
					}
					// 遅延はストーリー専用。実装の待機条件は UI の状態で検証する。
					setTimeout(
						createSymbolReply(mock, message, setCompleted),
						message.query === "slow" ? 800 : 0,
					);
					return;
				}
				mock.postMessage(message);
			},
		} satisfies Bridge;
	})();
</script>

<ChatApp {bridge} />
<output hidden aria-label="送信した本文">{sent}</output>
<output hidden aria-label="開いた参照">{opened}</output>
<output hidden aria-label="検索したシンボル">{JSON.stringify(queries)}</output>
<output hidden aria-label="検索完了">{JSON.stringify(completed)}</output>
