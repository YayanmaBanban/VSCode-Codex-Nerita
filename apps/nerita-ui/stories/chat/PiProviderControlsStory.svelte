<!-- 設定要求への固定応答だけを注入し、SDK や実サービスを起動せず描画を確認する。 -->
<script lang="ts">
	import { createBuiltinUiRegistry } from "../../../../apps/vscode-nerita/src/extension/ui-contributions/builtinContributions";
	import { initialState, type ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { untrack } from "svelte";
	import ComposerSettings from "../../src/chat/composer/ComposerSettings.svelte";
	import {
		connected,
		fallback,
		anthropic,
	} from "./fixtures/piProviderControls";
	import "../../src/chat/chat.css";

	let { noMetadata = false }: { noMetadata?: boolean } = $props();
	const registry = createBuiltinUiRegistry();
	let chatState = $state.raw<ChatState>(
		untrack(() => ({
			...initialState(),
			connection: "ready",
			sessionId: "pi-controls-story",
			configOptions: noMetadata ? fallback : connected,
			quota: [
				{
					label: "Weekly",
					remaining: 82,
					detail: "リセット: 2026-09-28T10:00:00Z",
					source: "codex-login",
				},
			],
		})),
	);
	let requests = $state.raw<UiMessage[]>([]);
	const contributions = $derived(
		registry.resolve(chatState, {
			backend: "pi",
			provider:
				chatState.configOptions.find(
					(option) => option.id === "provider",
				)?.currentValue ?? null,
			capabilities: [],
		}),
	);
	/** UI が送った値を記録し、受信する次の状態通知を模擬する。 */
	function send(message: UiMessage) {
		requests = [...requests, message];
		if (message.type !== "config/set") {
			return;
		}
		const providerOptions =
			message.value === "anthropic" ? anthropic : connected;
		chatState = {
			...chatState,
			quota: message.configId === "provider" ? null : chatState.quota,
			configOptions:
				message.configId === "provider"
					? providerOptions
					: chatState.configOptions.map((option) =>
							option.id === message.configId
								? { ...option, currentValue: message.value }
								: option,
						),
		};
	}
</script>

<div class="p-[12px]">
	<p>Pi Provider Controls</p>
	<div class="flex flex-wrap gap-[4px]">
		<button
			type="button"
			onclick={() => {
				chatState = {
					...chatState,
					run: chatState.run === "running" ? "idle" : "running",
				};
			}}
		>
			実行状態を切替
		</button>
		<button
			type="button"
			onclick={() => {
				chatState = { ...chatState, connection: "disconnected" };
			}}
		>
			切断
		</button>
		<button
			type="button"
			onclick={() => {
				chatState = { ...chatState, quota: null };
			}}
		>
			利用枠取得失敗
		</button>
	</div>
	<ComposerSettings
		state={{ ...chatState, uiContributions: contributions }}
		{send}
	/>
	<output
		aria-label="送信した要求"
		class="mt-[12px] block text-[12px] [overflow-wrap:anywhere]"
	>
		{JSON.stringify(requests)}
	</output>
</div>
