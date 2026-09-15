// ターン終了後も届くAIRタスク更新をセッションの履歴に反映する。
import type { ChatState } from "../../shared/messages";
import { taskActive } from "../../shared/asyncTask";
import type { TaskUpdate } from "../acp/airTasks";
/** タスクIDをキーに更新し、完了後の重複spawnで実行中へ戻さない。 */
export function updateAsyncTasks(
	state: ChatState,
	update: TaskUpdate,
): Partial<ChatState> {
	if (state.sessionId !== update.sessionId) {
		return {};
	}
	const existing = state.asyncTasks.find(
		(task) => task.asyncTaskId === update.task.asyncTaskId,
	);
	if (existing && update.spawned) {
		return {};
	}
	const task = {
		...existing,
		...update.task,
		canStop: update.spawned
			? update.task.canStop
			: taskActive(update.task) && (existing?.canStop ?? false),
		stopPending: false,
	};
	return {
		asyncTasks: existing
			? state.asyncTasks.map((item) => (item === existing ? task : item))
			: [...state.asyncTasks, task],
	};
}
