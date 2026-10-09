// 閲覧中のエージェントと子孫の停止、およびセッション全体の承認を操作する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { agentSubtree, type SubAgentSummary } from "@nerita/shared/subAgents";
import { cn } from "cnfast";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { Activity } from "../Activity";

/** 閲覧中以外の子エージェントも承認待ちになり得るため、親の承認一覧を表示する。 */
export function AgentRunControls({
	state,
	send,
	agent,
	onStop,
	stopping,
	stopError,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
	agent: SubAgentSummary;
	onStop: () => void;
	stopping: boolean;
	stopError: string | null;
}) {
	const active = agentSubtree(
		[
			agent,
			...state.agents.filter((item) => item.threadId !== agent.threadId),
		],
		agent.threadId,
	).some((item) => ["running", "pendingInit", "idle"].includes(item.status));
	if (
		!active &&
		!stopping &&
		stopError === null &&
		state.permissions.length === 0
	) {
		return null;
	}
	return (
		<aside
			aria-label="エージェントの停止・承認"
			className={cn(
				"max-h-[45%] shrink-0 overflow-y-auto border-t border-solid",
				"border-message-border p-3 text-[12px]",
			)}
		>
			<div className="mb-2 flex items-center justify-between gap-3">
				<span>自身と子の停止</span>
				<button
					type="button"
					disabled={!active || stopping}
					className={cn(
						"rounded border border-solid border-message-border px-3 py-2",
						"hover:bg-message-user",
						"disabled:opacity-40",
					)}
					onClick={onStop}
				>
					{stopping ? "停止要求中…" : "自身と子を停止"}
				</button>
			</div>
			{isNonEmptyString(stopError) && (
				<p role="alert" className="text-tool-error">
					{stopError}
				</p>
			)}
			{state.permissions.length > 0 && (
				<>
					<p>セッション全体の承認</p>
					<Activity state={{ ...state, tools: [] }} send={send} />
				</>
			)}
		</aside>
	);
}
