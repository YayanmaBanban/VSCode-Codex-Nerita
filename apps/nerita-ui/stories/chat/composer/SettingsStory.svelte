<script lang="ts">
	import ChatApp from "../StoryChat.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";
	import type { UiMessage } from "@nerita/shared/messages";
	import { settingsFixture } from "../fixtures/settingsFixture";
	import SettingsStoryControls from "./SettingsStoryControls.svelte";

	/** 設定表示のストーリーで使う権限モードと承認者。 */
	type SettingsStoryProps = {
		mode?: string;
		reviewer?: string;
	};

	/** モードと承認者の組合せを初期状態へ反映する。 */
	function createSettingsStoryBridge(
		mode: string,
		reviewer: string,
	): () => ReturnType<typeof createChatStoryBridge> {
		return () => {
			const bridge = createChatStoryBridge("empty");
			bridge.patchState({
				configOptions: settingsFixture().map((option) => {
					if (option.id === "mode") {
						return { ...option, currentValue: mode };
					}
					if (option.id === "approvals_reviewer") {
						return { ...option, currentValue: reviewer };
					}
					return option;
				}),
			});
			return bridge;
		};
	}
	let {
		mode = "workspace-write",
		reviewer = "auto_review",
	}: SettingsStoryProps = $props();
	const mock = $derived.by(() => createSettingsStoryBridge(mode, reviewer)());
	let last = $state.raw<UiMessage | undefined>(undefined);
	const setLast = (
		value: typeof last | ((previous: typeof last) => typeof last),
	) => {
		last = typeof value === "function" ? value(last) : value;
	};
	const bridge = $derived.by(() => ({
		...mock,
		subscribe: mock.subscribe,
		postMessage: (message: UiMessage) => {
			setLast(message);
			mock.postMessage(message);
		},
	}));
</script>

<SettingsStoryControls {mock} /><ChatApp {bridge} /><output
	aria-label="最後の要求">{last && JSON.stringify(last)}</output
>
