<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import { initialState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import Activity from "../../../src/chat/Activity.svelte";
	import "../../../src/chat/chat.css";
	import { tools } from "./ActivityToolsData";

	let request = $state.raw<UiMessage | undefined>(undefined);
	function setRequest(
		value: typeof request | ((current: typeof request) => typeof request),
	) {
		request = typeof value === "function" ? value(request) : value;
	}
	let completed = $state.raw(false);
	function setCompleted(
		value:
			| typeof completed
			| ((current: typeof completed) => typeof completed),
	) {
		completed = typeof value === "function" ? value(completed) : value;
	}
</script>

<main class="p-4">
	<button type="button" onclick={() => setCompleted(true)}>
		完了通知を受信
	</button>
	<Activity
		state={{
			...initialState(),
			cwd: "D:/workspace",
			tools: completed
				? tools.map((tool) => ({
						...tool,
						status: "completed",
					}))
				: tools,
		}}
		send={setRequest}
	></Activity>
	<output aria-label="送信した要求" class="[overflow-wrap:anywhere]">
		{request && JSON.stringify(request)}
	</output>
</main>
