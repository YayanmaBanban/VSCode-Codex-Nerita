<!-- 手動タスクの実行履歴と工程の進行を分けて表示する。 -->
<script lang="ts">
	import type {
		DlcAction,
		DlcProjection,
		DlcTask,
	} from "@nerita/shared/dlc/contracts";
	import type { UiMessage } from "@nerita/shared/messages";
	import TaskForm from "./TaskForm.svelte";

	let {
		selected,
		active,
		action,
		send,
	}: {
		selected: DlcProjection;
		active: boolean;
		action: (action: DlcAction) => void;
		send: (message: UiMessage) => void;
	} = $props();
	const statusLabels = {
		ready: "待機",
		running: "実行中",
		stopping: "停止中",
		completed: "実行終了",
		implemented: "実装済み・レビュー待ち",
		failed: "失敗",
		cancelled: "停止済み",
		interrupted: "中断・確認が必要",
	};
</script>

<section aria-label="手動タスク">
	<h3 class="text-[13px]">手動タスク</h3>
	<p class="text-muted">
		手動タスクの実装は、工程の完了や検証の通過とは別に記録されます。
	</p>
	{#if selected.stage === "planning" && selected.workflowStatus === "in-flight"}
		{#key selected.intentId}
			<TaskForm
				onPlan={(tasks: DlcTask[]) => action({ type: "plan", tasks })}
			/>
		{/key}
	{/if}
	<div class="dlc-toolbar">
		<button
			type="button"
			disabled={!selected.canRun || active}
			onclick={() => action({ type: "run" })}
		>
			手動タスクを実行
		</button>
		<button
			type="button"
			disabled={!selected.canCancel}
			onclick={() => action({ type: "cancel" })}
		>
			実行を停止
		</button>
	</div>
	<ul class="dlc-work-items">
		{#each selected.workItems as item (item.id)}
			<li>
				<strong>{item.title}</strong> · {statusLabels[item.status]}
				{#if item.detail !== null}<p>{item.detail}</p>{/if}
				{#if ["failed", "cancelled", "interrupted"].includes(item.status)}<button
						type="button"
						disabled={selected.canCancel}
						onclick={() =>
							action({ type: "retry", workItemId: item.id })}
					>
						変更を確認して再試行を準備
					</button>{/if}
				{#each item.attempts as attempt, index (attempt.id)}<button
						type="button"
						onclick={() =>
							send({
								type: "dlc/attempt",
								requestId: crypto.randomUUID(),
								intentId: selected.intentId,
								attemptId: attempt.id,
							})}
						>実行 {index + 1} · {statusLabels[
							attempt.status
						]}</button
					>{/each}
			</li>
		{/each}
	</ul>
</section>
