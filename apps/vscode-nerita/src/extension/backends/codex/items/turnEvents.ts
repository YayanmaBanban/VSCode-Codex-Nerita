// ターン処理で使う通知を検証し、会話・ターン・項目の識別子を共通の形式で取り出す。

import { parseCodexItem, type CodexItem } from "../protocol/item";
import { parseActivityUpdate, type ActivityUpdate } from "./activityEvent";
import { isRecord } from "@nerita/shared/validation";
import type { AppServerNotification } from "../protocol/rpcMessage";
import { parseTurn, type TurnInfo } from "../protocol/turn";
import { z } from "zod";
import type { GuardianApprovalReview } from "../codex-app-server/v2/GuardianApprovalReview";

/** 対象ターンへ適用できる通知だけを表す。 */
export type TurnEvent =
	| {
			kind: "activity";
			threadId: string;
			turnId: string;
			update: ActivityUpdate;
	  }
	| {
			kind: "turn";
			threadId: string;
			turnId: string;
			turn: TurnInfo;
			completed: boolean;
			items: CodexItem[];
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
			item: CodexItem;
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
	if (!supportedTurnMethods().includes(message.method)) {
		return null;
	}
	const params = message.params;
	if (!isRecord(params)) {
		throw new Error("Invalid event params");
	}
	const threadId = text(params.threadId);
	if (["turn/started", "turn/completed"].includes(message.method)) {
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
			items: turnItems(params),
		};
	}
	const turnId = text(params.turnId);
	if (
		[
			"item/autoApprovalReview/started",
			"item/autoApprovalReview/completed",
		].includes(message.method)
	) {
		const completed = message.method.endsWith("/completed");
		return {
			kind: "item",
			threadId,
			turnId,
			item: approvalReviewItem(params, completed),
			completed,
		};
	}
	if (
		![
			"item/agentMessage/delta",
			"item/plan/delta",
			"item/started",
			"item/completed",
		].includes(message.method)
	) {
		return {
			kind: "activity",
			threadId,
			turnId,
			update: parseActivityUpdate(message.method, params),
		};
	}
	if (
		message.method === "item/agentMessage/delta" ||
		message.method === "item/plan/delta"
	) {
		return {
			kind: "delta",
			threadId,
			turnId,
			itemId: text(params.itemId),
			delta: text(params.delta),
		};
	}
	const item = parseCodexItem(params.item);
	return {
		kind: "item",
		threadId,
		turnId,
		item,
		completed: message.method === "item/completed",
	};
}

/** ターン状態へ適用できる通知の種類を定義する。 */
function supportedTurnMethods() {
	return [
		"turn/started",
		"turn/completed",
		"item/started",
		"item/completed",
		"item/autoApprovalReview/started",
		"item/autoApprovalReview/completed",
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
	];
}

/** 審査 ID を独立した項目へ変換し、対象項目がない審査や同じ操作への複数審査も保持する。 */
function approvalReviewItem(
	params: Record<string, unknown>,
	completed: boolean,
): CodexItem {
	const review: GuardianApprovalReview = z
		.object({
			status: z.enum([
				"inProgress",
				"approved",
				"denied",
				"timedOut",
				"aborted",
			]),
			riskLevel: z.enum(["low", "medium", "high", "critical"]).nullable(),
			userAuthorization: z
				.enum(["unknown", "low", "medium", "high"])
				.nullable(),
			rationale: z.string().nullable(),
		})
		.parse(params.review);
	if (completed && review.status === "inProgress") {
		throw new Error("Invalid review completion");
	}
	return {
		...params,
		id: `autoApprovalReview:${text(params.reviewId)}`,
		type: "autoApprovalReview",
		review,
		action: z.record(z.string(), z.unknown()).parse(params.action),
		status:
			completed && review.status !== "approved"
				? "failed"
				: review.status,
	};
}

/** 完了通知の項目配列を取得する。 */
function turnItems(params: Record<string, unknown>): CodexItem[] {
	return isRecord(params.turn) && Array.isArray(params.turn.items)
		? params.turn.items.map(parseCodexItem)
		: [];
}
