// 手動タスクの操作を正式な工程の進行と区別し、履歴の表示は共通チャットへ接続する。
import type { DlcAction, DlcProjection } from "@nerita/shared/dlc/contracts";
import type { UiMessage } from "@nerita/shared/messages";
import { TaskForm } from "./DlcForms";

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

type WorkProps = {
	selected: DlcProjection;
	active: boolean;
	action: (action: DlcAction) => void;
	send: (message: UiMessage) => void;
};
export function DlcWorkItems({ selected, active, action, send }: WorkProps) {
	return (
		<section aria-label="手動タスク">
			<h3 className="text-[13px]">手動タスク</h3>
			<p className="text-muted">
				手動タスクの実装は、工程の完了や検証の通過とは別に記録されます。
			</p>
			{selected.stage === "planning" &&
				selected.workflowStatus === "in-flight" && (
					<TaskForm
						key={selected.intentId}
						onPlan={(tasks) => action({ type: "plan", tasks })}
					/>
				)}
			<div className="dlc-toolbar">
				<button
					type="button"
					disabled={!selected.canRun || active}
					onClick={() => action({ type: "run" })}
				>
					手動タスクを実行
				</button>
				<button
					type="button"
					disabled={!selected.canCancel}
					onClick={() => action({ type: "cancel" })}
				>
					実行を停止
				</button>
			</div>
			<ul className="dlc-work-items">
				{selected.workItems.map((item) => (
					<WorkItem
						key={item.id}
						item={item}
						selected={selected}
						action={action}
						send={send}
					/>
				))}
			</ul>
		</section>
	);
}

function WorkItem({
	item,
	selected,
	action,
	send,
}: Pick<WorkProps, "selected" | "action" | "send"> & {
	item: DlcProjection["workItems"][number];
}) {
	return (
		<li>
			<strong>{item.title}</strong> · {statusLabels[item.status]}
			{item.detail !== null && <p>{item.detail}</p>}
			{["failed", "cancelled", "interrupted"].includes(item.status) && (
				<button
					type="button"
					disabled={selected.canCancel}
					onClick={() =>
						action({ type: "retry", workItemId: item.id })
					}
				>
					変更を確認して再試行を準備
				</button>
			)}
			{item.attempts.map((attempt, index) => (
				<button
					key={attempt.id}
					type="button"
					onClick={() => {
						send({
							type: "dlc/attempt",
							requestId: crypto.randomUUID(),
							intentId: selected.intentId,
							attemptId: attempt.id,
						});
						send({
							type: "dlc/chat",
							requestId: crypto.randomUUID(),
						});
					}}
				>
					実行 {index + 1} · {statusLabels[attempt.status]}
				</button>
			))}
		</li>
	);
}
