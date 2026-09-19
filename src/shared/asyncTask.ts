// AIRタスクとコマンドカードの対応を、端末IDとは別に管理する。
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

/** AIRタスクの通信値を検証する。 */
export function isAsyncTask(value: unknown): value is AsyncTask {
	return (
		isRecord(value) &&
		typeof value.asyncTaskId === "string" &&
		value.asyncTaskId.length > 0 &&
		(value.toolCallId === undefined ||
			typeof value.toolCallId === "string") &&
		["running", "paused", "completed", "failed", "stopped"].includes(
			String(value.state),
		) &&
		typeof value.canStop === "boolean" &&
		(value.stopPending === undefined ||
			typeof value.stopPending === "boolean")
	);
}
