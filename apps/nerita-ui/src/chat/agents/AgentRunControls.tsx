// 子の閲覧中も親の実行に属する承認と全体停止を操作できるようにする。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { cn } from "cnfast";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { Activity } from "../Activity";

/** 閲覧中以外の子エージェントも承認待ちになり得るため、親の承認一覧を表示する。 */
export function AgentRunControls({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	const activeChildren = state.agents.some(
		(agent) => agent.status === "running" || agent.status === "pendingInit",
	);
	if (
		state.run !== "running" &&
		state.run !== "cancelling" &&
		!activeChildren &&
		state.permissions.length === 0
	) {
		return null;
	}
	return (
		<aside
			aria-label="親と子の実行操作"
			className={cn(
				"max-h-[45%] shrink-0 overflow-y-auto border-t border-solid",
				"border-message-border p-3 text-[12px]",
			)}
		>
			<div className="mb-2 flex items-center justify-between gap-3">
				<span>親と子の実行・承認</span>
				<button
					type="button"
					disabled={state.run === "cancelling"}
					className={cn(
						"rounded border border-solid border-message-border px-3 py-2",
						"hover:bg-message-user",
						"disabled:opacity-40",
					)}
					onClick={() => {
						if (
							isNonEmptyString(state.sessionId) &&
							isNonEmptyString(state.runId)
						) {
							send({
								type: "prompt/cancel",
								requestId: crypto.randomUUID(),
								sessionId: state.sessionId,
								runId: state.runId,
							});
						}
					}}
				>
					すべて停止
				</button>
			</div>
			<Activity state={{ ...state, tools: [] }} send={send} />
		</aside>
	);
}
