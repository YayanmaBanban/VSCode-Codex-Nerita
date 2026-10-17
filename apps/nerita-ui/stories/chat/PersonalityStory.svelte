<script lang="ts">
	import ChatApp from "./StoryChat.svelte";
	import { createChatStoryBridge } from "./mocks/mockBridge";
	import type { PersonalitySettings } from "@nerita/shared/personality";

	let {
		configured = false,
		pending = false,
		failure = false,
	}: {
		configured?: boolean;
		pending?: boolean;
		failure?: boolean;
	} = $props();
	const bridge = $derived.by(() => {
		const mock = createChatStoryBridge();
		const settings: PersonalitySettings = {
			global: {
				presets: [
					{ name: "簡潔", text: "日本語で簡潔に回答する。" },
					{ name: "レビュー", text: "判断理由を具体的に説明する。" },
				],
				selected: "簡潔",
				configuredText: configured
					? "日本語で回答する。\n技術的な判断理由を省略しない。"
					: null,
			},
			workspace: {
				presets: [],
				selected: "",
				configuredText: configured
					? "このプロジェクトでは既存設計を優先する。"
					: null,
			},
		};
		return {
			...mock,
			postMessage(message: Parameters<typeof mock.postMessage>[0]) {
				mock.postMessage(message);
				if (message.type === "personality/read") {
					if (pending) {
						return;
					}
					if (failure) {
						mock.emit({
							type: "request/failed",
							requestId: message.requestId,
							error: "性格設定を取得できませんでした。再試行してください。",
						});
						return;
					}
					mock.patchState({ personality: settings });
				}
			},
		};
	});
</script>

<ChatApp {bridge} />
