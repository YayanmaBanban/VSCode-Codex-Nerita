// SDKの標準スキーマにないAIR通知を検証し、タスク更新へ変換する。
import { isRecord } from "../../shared/validation";
import { isAsyncTask, type AsyncTask } from "../../shared/asyncTask";
/** 検証済みのAIR通知。 */
export type TaskUpdate = {
	sessionId: string;
	task: AsyncTask;
	spawned: boolean;
};
/** 相手のinitialize応答がAIR asyncTasksに対応するか確認する。 */
export function supportsAsyncTasks(meta: unknown): boolean {
	if (
		!isRecord(meta) ||
		!isRecord(meta.jetbrains) ||
		!isRecord(meta.jetbrains.air)
	) {
		return false;
	}
	const air = meta.jetbrains.air;
	return (
		typeof air.version === "number" &&
		air.version >= 1 &&
		Array.isArray(air.capabilities) &&
		air.capabilities.includes("asyncTasks")
	);
}
/** 未知の通知はSDKへ渡し、AIR通知は不正な値もここで消費する。 */
export function consumeTaskUpdate(
	params: unknown,
	receive: (update: TaskUpdate) => void,
): boolean {
	if (!isRecord(params) || !isRecord(params.update)) {
		return false;
	}
	const value = params.update;
	if (
		value.sessionUpdate !== "async_task_spawned" &&
		value.sessionUpdate !== "async_task_state_update"
	) {
		return false;
	}
	const spawned = value.sessionUpdate === "async_task_spawned";
	const task = {
		asyncTaskId: value.asyncTaskId,
		...(value.toolCallId !== undefined
			? { toolCallId: value.toolCallId }
			: {}),
		state: spawned ? "running" : value.state,
		canStop: spawned ? value.canStop : false,
	};
	if (
		typeof params.sessionId === "string" &&
		params.sessionId.length > 0 &&
		isAsyncTask(task)
	) {
		receive({ sessionId: params.sessionId, task, spawned });
	}
	return true;
}
