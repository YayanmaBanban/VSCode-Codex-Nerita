<script lang="ts">
	// 本体のチャットを描画し、Storybook 内だけで送信記録と応答注入を公開する。
	import ChatApp from "../../src/chat/ChatApp.svelte";
	import type { UiMessage } from "@nerita/shared/messages";
	import type { StoryBridge } from "./mocks/storyBridge";
	let { bridge }: { bridge: StoryBridge } = $props();
	const observed = $derived.by(() => {
		const sent: UiMessage[] = [];
		return {
			...bridge,
			sent,
			/** 本体と同じ要求を転送し、その値を検証に残す。 */
			postMessage(message: UiMessage) {
				sent.push(structuredClone(message));
				bridge.postMessage(message);
			},
		};
	});
	/** 通信窓口の所有者は、このストーリーの描画要素に限定する。 */
	function attachBridge(element: HTMLElement) {
		// Bridge の交換後も DOM の検証窓口が最新の通信先を公開するように同期する。
		$effect(() => {
			Object.assign(element, { storyBridge: observed });
		});
		return () => {
			Reflect.deleteProperty(element, "storyBridge");
		};
	}
</script>

<div style="display: contents" data-story-chat {@attach attachBridge}>
	<ChatApp bridge={observed} />
</div>
