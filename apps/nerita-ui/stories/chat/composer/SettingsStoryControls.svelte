<script lang="ts">
	import { type createChatStoryBridge } from "../mocks/mockBridge";
	let { mock }: { mock: ReturnType<typeof createChatStoryBridge> } = $props();
</script>

<div class="flex flex-wrap gap-1">
	<button
		onclick={() =>
			mock.patchState({
				quota: [
					{
						label: "codex 5h limit",
						remaining: 60,
						detail: "resets 18:00",
					},
					{ label: "codex Weekly limit", remaining: 85, detail: "" },
				],
			})}>利用枠取得</button
	>
	<button onclick={() => mock.patchState({ quota: null })}
		>利用枠取得失敗</button
	>
	<button
		onclick={() => mock.patchState({ usage: { used: 400, size: 1000 } })}
		>使用量40%</button
	>
	<button
		onclick={() => mock.patchState({ usage: { used: 600, size: 1000 } })}
		>使用量60%</button
	>
	<button
		onclick={() => mock.patchState({ usage: { used: 200, size: 1000 } })}
		>使用量20%</button
	>
	<button onclick={() => mock.patchState({ connection: "disconnected" })}
		>切断通知</button
	>
</div>
