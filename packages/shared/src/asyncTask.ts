// AIR タスクとコマンドカードの対応を、端末 ID とは別に管理する。
import { isRecord } from "./validation";

/** セッション内のバックグラウンドタスク。 */
export type AsyncTask = {
	asyncTaskId: string;
	toolCallId?: string;
	state: "running" | "paused" | "completed" | "failed" | "stopped";
	canStop: boolean;
	stopPending?: boolean;
};

/** 実行が終了していないタスクを判定する。 */
export function taskActive(task: AsyncTask): boolean {
	return task.state === "running" || task.state === "paused";
}

/** AIR タスクの通信値を検証する。 */
export function isAsyncTask(value: unknown): value is AsyncTask {
	if (!isRecord(value)) {
		return false;
	}
	if (!(typeof value.asyncTaskId === "string")) {
		return false;
	}
	if (!(value.asyncTaskId.length > 0)) {
		return false;
	}

	const invalidToolCallId = !(
		value.toolCallId === undefined || typeof value.toolCallId === "string"
	);
	if (invalidToolCallId) {
		return false;
	}
	if (!(typeof value.state === "string")) {
		return false;
	}

	const unknownTaskState = ![
		"running",
		"paused",
		"completed",
		"failed",
		"stopped",
	].includes(value.state);
	if (unknownTaskState) {
		return false;
	}
	if (!(typeof value.canStop === "boolean")) {
		return false;
	}
	return (
		value.stopPending === undefined ||
		typeof value.stopPending === "boolean"
	);
}
