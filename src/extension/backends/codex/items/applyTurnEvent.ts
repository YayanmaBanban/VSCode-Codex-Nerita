// ターン内の通知を到着順に適用し、完了済み項目への遅延deltaを抑止する。
import type { ChatState } from "../../../../shared/chatState";
import { isRecord } from "../../../../shared/validation";
import type { ActiveTurn } from "../ActiveTurn";
import type { AppServerNotification } from "../protocol/rpcMessage";
import type { TurnEvent } from "./turnEvents";
import { itemPatch, messagePatch } from "./chatItems";
import { activityPatch } from "./activityEvents";

type TurnTarget = {
	// 同一通知内でも適用済みの項目を次の更新に含めるため、状態は都度取得する。
	snapshot(): ChatState;
	patch(change: Partial<ChatState>): void;
	agentNotification(message: AppServerNotification): void;
	interrupt(): void;
	finish(status: "completed" | "cancelled" | "failed"): void;
};

/** 接続・thread・turnの一致を呼び出し元で確認してから適用する。 */
export function applyTurnEvent(
	run: ActiveTurn,
	event: TurnEvent,
	target: TurnTarget,
): void {
	if (event.kind === "delta" && !run.completedItems.has(event.itemId)) {
		target.patch(
			messagePatch(target.snapshot(), event.itemId, event.delta, true),
		);
	}

	if (event.kind === "activity") {
		target.patch(
			activityPatch(
				target.snapshot(),
				event.method,
				event.params,
				run.streams,
				run.completedItems,
			),
		);
	}

	if (event.kind === "item") {
		const id = String(event.item.id);
		if (
			["subAgentActivity", "collabAgentToolCall"].includes(
				String(event.item.type),
			)
		) {
			target.agentNotification({
				method: event.completed ? "item/completed" : "item/started",
				params: {
					threadId: event.threadId,
					turnId: event.turnId,
					item: event.item,
				},
			});
		}
		if (
			!run.completedItems.has(id) &&
			!["subAgentActivity", "collabAgentToolCall"].includes(
				String(event.item.type),
			)
		) {
			target.patch(
				itemPatch(target.snapshot(), event.item, event.completed),
			);
		}
		if (event.completed) {
			run.completedItems.add(id);
		}
	}

	// 開始受付の応答だけでは、サーバー内部のターンがまだ実行中になっていない。
	if (event.kind === "turn" && !event.completed) {
		run.started = true;
		if (target.snapshot().run === "cancelling") {
			target.interrupt();
		}
	}

	if (event.kind === "turn" && event.completed) {
		for (const item of event.items) {
			if (
				isRecord(item) &&
				["subAgentActivity", "collabAgentToolCall"].includes(
					String(item.type),
				)
			) {
				target.agentNotification({
					method: "item/completed",
					params: {
						threadId: event.threadId,
						turnId: event.turnId,
						item,
					},
				});
				continue;
			}
			target.patch(itemPatch(target.snapshot(), item, true));
		}
		target.finish(
			event.turn.status === "interrupted"
				? "cancelled"
				: event.turn.status === "failed"
					? "failed"
					: "completed",
		);
	}
}
