// Phase 1 が使う通知を検証し、会話・ターン・項目の識別子を正規化する。
import { isRecord } from "../../shared/validation";
import type { AppServerNotification } from "./rpcMessage";
import { parseTurn, type TurnInfo } from "./turnProtocol";

/** 対象ターンへ適用できる通知だけを表す。 */
export type TurnEvent =
	| {
			kind: "activity";
			threadId: string;
			turnId: string;
			method: string;
			params: Record<string, unknown>;
	  }
	| {
			kind: "turn";
			threadId: string;
			turnId: string;
			turn: TurnInfo;
			completed: boolean;
			items: unknown[];
	  }
	| {
			kind: "delta";
			threadId: string;
			turnId: string;
			itemId: string;
			delta: string;
	  }
	| {
			kind: "item";
			threadId: string;
			turnId: string;
			item: Record<string, unknown>;
			completed: boolean;
	  };
/** 必須の文字列フィールドを検証する。 */
function text(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid event field");
	}
	return value;
}
/** 未対応通知は無視し、対応通知の形式違反は接続側へ伝える。 */
export function parseTurnEvent(
	message: AppServerNotification,
): TurnEvent | null {
	if (
		![
			"turn/started",
			"turn/completed",
			"item/started",
			"item/completed",
			"item/agentMessage/delta",
			"item/commandExecution/outputDelta",
			"item/commandExecution/terminalInteraction",
			"item/fileChange/outputDelta",
			"item/fileChange/patchUpdated",
			"item/reasoning/summaryTextDelta",
			"item/reasoning/summaryPartAdded",
			"item/reasoning/textDelta",
			"item/plan/delta",
			"item/mcpToolCall/progress",
			"turn/plan/updated",
			"turn/diff/updated",
		].includes(message.method)
	) {
		return null;
	}
	const params = message.params;
	if (!isRecord(params)) {
		throw new Error("Invalid event params");
	}
	const threadId = text(params.threadId);
	if (
		message.method === "turn/started" ||
		message.method === "turn/completed"
	) {
		const turn = parseTurn(params.turn);
		if (
			message.method === "turn/completed" &&
			turn.status === "inProgress"
		) {
			throw new Error("Invalid completion");
		}
		return {
			kind: "turn",
			threadId,
			turnId: turn.id,
			turn,
			completed: message.method === "turn/completed",
			items:
				isRecord(params.turn) && Array.isArray(params.turn.items)
					? params.turn.items
					: [],
		};
	}
	const turnId = text(params.turnId);
	if (
		!["item/agentMessage/delta", "item/started", "item/completed"].includes(
			message.method,
		)
	) {
		return {
			kind: "activity",
			threadId,
			turnId,
			method: message.method,
			params,
		};
	}
	if (message.method === "item/agentMessage/delta") {
		return {
			kind: "delta",
			threadId,
			turnId,
			itemId: text(params.itemId),
			delta: text(params.delta),
		};
	}
	if (!isRecord(params.item)) {
		throw new Error("Invalid item");
	}
	text(params.item.id);
	text(params.item.type);
	return {
		kind: "item",
		threadId,
		turnId,
		item: params.item,
		completed: message.method === "item/completed",
	};
}
