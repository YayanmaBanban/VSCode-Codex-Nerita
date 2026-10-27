<!-- Pi の保存履歴と同じ形式の審査結果を既存のツールカードで確認する。 -->
<script lang="ts">
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import "../../../src/chat/chat.css";

	const outcomes = [
		"approved",
		"denied",
		"needsApproval",
		"aborted",
	] as const;
	const toolStatuses = {
		approved: "completed",
		denied: "failed",
		needsApproval: "completed",
		aborted: "cancelled",
	} as const;
</script>

<main class="grid gap-4 p-4">
	{#each outcomes as status (status)}
		<ToolCard
			tool={{
				id: `autoApprovalReview:${status}`,
				title: "Guardian Review",
				kind: "think",
				status: toolStatuses[status],
				paths: [],
				rawOutput: {
					action: {
						tool: "write",
						cwd: "workspace",
						path: "package.json",
					},
					review: {
						id: `example-${status}`,
						status,
						riskLevel: "low",
						userAuthorization: "high",
						rationale:
							"ユーザーが依頼したプロジェクト設定の更新です。",
						model: "local/test-model",
						durationMs: 1250,
						source: "prefetch",
						reusedFrom: "previous-review",
						reviewDurationMs: 1800,
					},
				},
			}}
		/>
	{/each}
</main>
