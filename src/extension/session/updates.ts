// ACP 通知を会話・ツール概要の差分に変換する。
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { ChatState } from "../../shared/messages";
import { configOptions } from "./configuration";
import { isRecord } from "../../shared/validation";
import { nextTimelineOrder } from "./timelineOrder";
/** 現在の実行に関係する通知だけを表示用状態へ変換する。 */
export function updateState(
	state: ChatState,
	notification: SessionNotification,
	replay = false,
): Partial<ChatState> {
	if (state.sessionId !== notification.sessionId) {
		return {};
	}
	const update = notification.update;
	// 設定と使用量はターン終了後にも届くセッション単位の通知。
	if (update.sessionUpdate === "usage_update") {
		return Number.isFinite(update.used) &&
			update.used >= 0 &&
			Number.isFinite(update.size) &&
			update.size > 0
			? { usage: { used: update.used, size: update.size } }
			: {};
	}
	if (update.sessionUpdate === "config_option_update") {
		return { configOptions: configOptions(update.configOptions) };
	}
	if (update.sessionUpdate === "current_mode_update") {
		return {
			configOptions: state.configOptions.map((option) =>
				option.id === "mode"
					? { ...option, currentValue: update.currentModeId }
					: option,
			),
		};
	}
	if (
		(state.run !== "running" &&
			!(
				update.sessionUpdate === "tool_call_update" &&
				state.tools.some((tool) => tool.id === update.toolCallId)
			)) ||
		state.sessionId !== notification.sessionId ||
		!state.runId
	) {
		return {};
	}
	if (
		(update.sessionUpdate === "agent_message_chunk" ||
			(replay && update.sessionUpdate === "user_message_chunk")) &&
		update.content.type === "text"
	) {
		const role: "user" | "assistant" =
			update.sessionUpdate === "user_message_chunk"
				? "user"
				: "assistant";
		const prefix = `${state.runId}:${update.messageId ?? role}:`;
		const last = state.messages.at(-1);
		// ツールを挟んだ本文は別の発言にし、後から届く本文が前へ結合されるのを防ぐ。
		const lastToolOrder = Math.max(
			-1,
			...state.tools.map((tool) => tool.order ?? -1),
		);
		const existing =
			last?.role === role &&
			last.id.startsWith(prefix) &&
			(last.order ?? -1) > lastToolOrder
				? last
				: undefined;
		const id = existing?.id ?? `${prefix}${state.revision + 1}`;
		const message = {
			id,
			order: existing?.order ?? nextTimelineOrder(state),
			role,
			text: (existing?.text ?? "") + update.content.text,
		};
		return {
			messages: existing
				? state.messages.map((m) => (m.id === id ? message : m))
				: [...state.messages, message],
		};
	}
	if (
		update.sessionUpdate === "tool_call" ||
		update.sessionUpdate === "tool_call_update"
	) {
		const existing = [...state.tools]
			.reverse()
			.find(
				(tool) =>
					tool.id === update.toolCallId &&
					(update.sessionUpdate === "tool_call_update" ||
						tool.runId === state.runId),
			);
		const jetbrains = update._meta?.jetbrains;
		const air = isRecord(jetbrains) ? jetbrains.air : undefined;
		const tasks = isRecord(air) ? air.asyncTasks : undefined;
		const paths = update.locations?.map((location) => location.path);
		const diffs = update.content?.flatMap((content) =>
			content.type === "diff" ? [content.path] : [],
		);
		const tool = {
			...existing,
			id: update.toolCallId,
			runId: existing?.runId ?? state.runId,
			...(isRecord(tasks) && typeof tasks.backgrounded === "boolean"
				? { backgrounded: tasks.backgrounded }
				: {}),
			order: existing?.order ?? nextTimelineOrder(state),
			...(isRecord(update._meta?.terminal_info) &&
			typeof update._meta.terminal_info.cwd === "string"
				? { cwd: update._meta.terminal_info.cwd }
				: {}),
			// 省略されたフィールドは保持し、明示された空配列・null は更新として扱う。
			...(update.kind !== undefined && update.kind !== null
				? { kind: update.kind }
				: {}),
			...(update.content !== undefined && update.content !== null
				? { content: update.content }
				: {}),
			...(update.rawInput !== undefined
				? { rawInput: update.rawInput }
				: {}),
			...(update.rawOutput !== undefined
				? { rawOutput: update.rawOutput }
				: {}),
			title: update.title ?? existing?.title ?? "ツール実行",
			status: update.status ?? existing?.status ?? "pending",
			paths:
				paths || diffs
					? [...new Set([...(paths ?? []), ...(diffs ?? [])])]
					: (existing?.paths ?? []),
		};
		return {
			tools: existing
				? state.tools.map((t) => (t === existing ? tool : t))
				: [...state.tools, tool],
		};
	}
	return {};
}
