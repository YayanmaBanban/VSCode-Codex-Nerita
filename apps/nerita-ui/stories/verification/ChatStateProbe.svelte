<script lang="ts">
	// 版番号の欠落と接続の入れ替えを、製品の状態 controller で確認する。
	import { initialState } from "@nerita/shared/chatState";
	import { untrack } from "svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import type { HostMessage } from "@nerita/shared/messages";
	import { useChat } from "../../src/chat/useChat.svelte";
	import { createStoryBridge } from "../chat/mocks/storyBridge";
	const initial = { ...initialState(), sessionId: "first", revision: 10 };
	const first = createStoryBridge(initial);
	const second = createStoryBridge({
		...initialState(),
		sessionId: "second",
		revision: 20,
	});
	let subscriptions = $state(0);
	let readyRequests = $state(0);
	let delayed: ((message: HostMessage) => void) | undefined;
	const tracked: Bridge = {
		/** ready の再要求だけを観測し、外部応答は既存の mock を使う。 */
		postMessage(message) {
			if (message.type === "ui/ready") {
				readyRequests += 1;
				first.emit({ type: "state/snapshot", state: initial });
			} else {
				first.postMessage(message);
			}
		},
		/** 通信が解除されても届く遅延 callback を意図的に保持する。 */
		subscribe(listener) {
			delayed = listener;
			untrack(() => {
				subscriptions += 1;
			});
			const unsubscribe = first.subscribe(listener);
			return () => {
				subscriptions -= 1;
				unsubscribe();
			};
		},
	};
	let bridge = $state.raw<Bridge>(tracked);
	const chat = useChat(() => bridge);
	/** 古い版・欠けた差分・正しい差分を同じ受信経路へ渡す。 */
	function emit(kind: "stale" | "gap" | "valid") {
		if (kind === "stale") {
			first.emit({
				type: "state/snapshot",
				state: { ...initialState(), revision: 9, sessionId: "stale" },
			});
		} else if (kind === "gap") {
			first.emit({
				type: "state/patch",
				revision: 12,
				baseRevision: 11,
				patch: { sessionId: "gap" },
			});
		} else {
			first.emit({
				type: "state/patch",
				revision: 11,
				baseRevision: 10,
				patch: { sessionId: "valid" },
			});
		}
	}
</script>

<output data-testid="session">{chat.state.sessionId}</output>
<output data-testid="revision">{chat.state.revision}</output>
<output data-testid="subscriptions">{subscriptions}</output>
<output data-testid="ready">{readyRequests}</output>
<button type="button" onclick={() => emit("stale")}>古い状態</button>
<button type="button" onclick={() => emit("gap")}>欠けた差分</button>
<button type="button" onclick={() => emit("valid")}>正しい差分</button>
<button
	type="button"
	onclick={() => {
		bridge = second;
	}}>接続を変更</button
>
<button
	type="button"
	onclick={() =>
		delayed?.({
			type: "state/snapshot",
			state: { ...initialState(), sessionId: "delayed", revision: 100 },
		})}>前の接続の遅延応答</button
>
