<script lang="ts">
	import ChatApp from "../StoryChat.svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import { createChatStoryBridge } from "../mocks/mockBridge";

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
	let changes = $state.raw("");
	const setChanges = (
		value: typeof changes | ((previous: typeof changes) => typeof changes),
	) => {
		changes = typeof value === "function" ? value(changes) : value;
	};
	const fail = { current: false };
	const bridge = (() => {
		const mock = createChatStoryBridge("empty");

		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "changes/open") {
					setChanges(message.scope);
					return;
				}
				if (message.type === "session/openReference") {
					setOpened(message.referencedSessionId);
					return;
				}
				if (message.type === "prompt/send") {
					setSent(JSON.stringify(message));
					if (fail.current) {
						fail.current = false;
						mock.emit({
							type: "request/failed",
							requestId: message.requestId,
							error: "参照セッションを読み込めませんでした。参照を外して再送してください。",
						});
						return;
					}
				}
				mock.postMessage(message);
			},
		} satisfies Bridge;
	})();
</script>

<ChatApp {bridge} />
<button
	type="button"
	onclick={() => {
		fail.current = true;
	}}
>
	次の送信を失敗
</button>
<output hidden aria-label="送信した参照">{sent}</output>
<output hidden aria-label="表示したセッション">{opened}</output>
<output hidden aria-label="表示した差分">{changes}</output>
