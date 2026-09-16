// 生成型のうち Phase 1 が利用する応答フィールドだけを検証して公開する。
import type { ThreadStartResponse } from "../../codex-app-server/v2/ThreadStartResponse";
import type { Turn } from "../../codex-app-server/v2/Turn";
import type { TurnInterruptResponse } from "../../codex-app-server/v2/TurnInterruptResponse";
import { isRecord } from "../../shared/validation";
import { parseSandbox } from "./sandboxProtocol";

/** 会話開始時に UI が必要とするサーバー確定情報。 */
export type StartedThread = Pick<ThreadStartResponse, "model" | "cwd"> & {
	thread: Pick<ThreadStartResponse["thread"], "id">;
	reasoningEffort?: string | null;
	serviceTier?: string | null;
	sandbox?: ReturnType<typeof parseSandbox>;
};
/** 未使用の詳細を型保証せず、ターンの識別子と状態だけを公開する。 */
export type TurnInfo = Pick<Turn, "id" | "status">;
/** thread/start の必要フィールドを検証する。 */
export function parseStartedThread(value: unknown): StartedThread {
	if (
		!isRecord(value) ||
		!isRecord(value.thread) ||
		typeof value.thread.id !== "string" ||
		!value.thread.id ||
		typeof value.model !== "string" ||
		typeof value.cwd !== "string"
	) {
		throw new Error("Invalid thread response");
	}
	return {
		thread: { id: value.thread.id },
		...(value.sandbox === undefined
			? {}
			: { sandbox: parseSandbox(value.sandbox) }),
		...(typeof value.reasoningEffort === "string" ||
		value.reasoningEffort === null
			? { reasoningEffort: value.reasoningEffort }
			: {}),
		...(typeof value.serviceTier === "string" || value.serviceTier === null
			? { serviceTier: value.serviceTier }
			: {}),
		model: value.model,
		cwd: value.cwd,
	};
}
/** 応答・通知で共通のターン状態を検証する。 */
export function parseTurn(value: unknown): TurnInfo {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		!value.id ||
		(value.status !== "inProgress" &&
			value.status !== "completed" &&
			value.status !== "interrupted" &&
			value.status !== "failed")
	) {
		throw new Error("Invalid turn");
	}
	return { id: value.id, status: value.status };
}
/** turn/start は開始受付として検証し、完了判定には使わない。 */
export function parseStartedTurn(value: unknown): { turn: TurnInfo } {
	if (!isRecord(value)) {
		throw new Error("Invalid turn response");
	}
	return { turn: parseTurn(value.turn) };
}
/** 追加指示が受け付けられたターンの識別子を検証する。 */
export function parseSteeredTurn(value: unknown): { turnId: string } {
	if (!isRecord(value) || typeof value.turnId !== "string" || !value.turnId) {
		throw new Error("Invalid steer response");
	}
	return { turnId: value.turnId };
}
/** interrupt の成功は空オブジェクトとして受け取る。 */
export function parseInterrupt(value: unknown): TurnInterruptResponse {
	if (!isRecord(value) || Object.keys(value).length) {
		throw new Error("Invalid interrupt response");
	}
	return {};
}
/** 認証情報を保持せず、既存認証の有無だけを返す。 */
export function parseAccount(value: unknown): {
	authenticated: boolean;
	requiresOpenaiAuth: boolean;
} {
	if (
		!isRecord(value) ||
		typeof value.requiresOpenaiAuth !== "boolean" ||
		!(
			value.account === null ||
			(isRecord(value.account) &&
				["apiKey", "chatgpt", "amazonBedrock"].includes(
					String(value.account.type),
				))
		)
	) {
		throw new Error("Invalid account response");
	}
	return {
		authenticated: value.account !== null,
		requiresOpenaiAuth: value.requiresOpenaiAuth,
	};
}
