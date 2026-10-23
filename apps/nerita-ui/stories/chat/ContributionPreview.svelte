<!-- Host の定義と同じ表示条件で設定を再生成し、実サービスに接続せず操作する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import type { BackendId } from "@nerita/shared/backend";
	import type { UiMessage } from "@nerita/shared/messages";
	import {
		createContributionState,
		createStoryContributions,
	} from "./contributionStoryModel";
	import ComposerSettings from "../../src/chat/composer/ComposerSettings.svelte";
	import "../../src/chat/chat.css";

	let { backend, provider }: { backend: BackendId; provider: string } =
		$props();
	const registry = createStoryContributions();
	let chatState = $state.raw(
		untrack(() => createContributionState(provider)),
	);
	let last = $state.raw<UiMessage>();
	let selectedProvider = $derived(
		chatState.configOptions
			.find((option) => option.id === "model")!
			.currentValue.split("/")[0]!,
	);
	let contributions = $derived.by(() => {
		const result = registry.resolve(chatState, {
			backend,
			provider: selectedProvider,
			capabilities: ["preview"],
		});
		return {
			...result,
			items: result.items.filter((item) => item.id !== "config:preview"),
		};
	});
	function send(message: UiMessage) {
		last = message;
		if (message.type !== "config/set") {
			return;
		}
		chatState = {
			...chatState,
			configOptions:
				message.configId === "preview"
					? [
							...chatState.configOptions.filter(
								(option) => option.id !== "preview",
							),
							{
								id: "preview",
								name: "Preview",
								currentValue: message.value,
								options: [],
							},
						]
					: chatState.configOptions.map((option) =>
							option.id === message.configId
								? { ...option, currentValue: message.value }
								: option,
						),
		};
	}
</script>

<div class="p-[12px]">
	<p>UI Contribution — {backend}</p>
	<p class="text-[12px] text-muted">
		モデルを切り替えると、Hostの定義に合わせて拡張設定の表示が変わります。
	</p>
	<button
		onclick={() =>
			(chatState = {
				...chatState,
				run: chatState.run === "running" ? "idle" : "running",
			})}>実行状態を切替</button
	>
	<button
		onclick={() =>
			(chatState = { ...chatState, connection: "disconnected" })}
		>切断</button
	>
	<ComposerSettings
		state={{ ...chatState, uiContributions: contributions }}
		{send}
	/>
	<output
		aria-label="最後の要求"
		class="mt-[12px] block text-[12px] [overflow-wrap:anywhere]"
		>{last ? JSON.stringify(last) : "未操作"}</output
	>
</div>
