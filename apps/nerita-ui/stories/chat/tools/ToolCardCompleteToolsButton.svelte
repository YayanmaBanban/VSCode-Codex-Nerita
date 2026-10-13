<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import type { AsyncTask } from "@nerita/shared/asyncTask";
	import "../../../src/chat/chat.css";

	let {
		setTasks,
		setTools,
	}: {
		setTasks: (
			value: AsyncTask[] | ((current: AsyncTask[]) => AsyncTask[]),
		) => void;
		setTools: (
			value: ToolSummary[] | ((current: ToolSummary[]) => ToolSummary[]),
		) => void;
	} = $props();
</script>

<button
	onclick={() => {
		setTasks((tasks) =>
			tasks.map((task) => ({
				...task,
				state: "completed",
				canStop: false,
			})),
		);
		setTools((current) =>
			current.map((tool) =>
				tool.status === "failed"
					? tool
					: {
							...tool,
							status: "completed",
							...(tool.id === "guardian"
								? {
										rawOutput: {
											review: {
												status: "approved",
												riskLevel: "low",
												userAuthorization: "high",
												rationale:
													"バージョン確認のため承認しました。",
											},
										},
									}
								: {}),
						},
			),
		);
	}}
>
	完了通知を受信
</button>
