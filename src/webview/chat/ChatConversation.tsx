// 会話ログ・ツール・承認と実行状態を1つのスクロール領域に配置する。
import type { RefObject } from "react";
import type { ChatState } from "../../shared/chatState";
import type { UiMessage } from "../../shared/messages";
import type { SubAgentSummary } from "../../shared/subAgents";
import { Activity } from "./Activity";
import { Messages } from "./messages/Messages";
import { AgentCard } from "./agents/AgentCard";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { RunStatusIcon } from "./RunStatusIcon";
import { PlanDecisionCard } from "./PlanDecisionCard";

const runLabels = {
	idle: "",
	running: "",
	cancelling: "停止しています…",
	completed: "",
	cancelled: "停止しました",
	failed: "実行に失敗しました",
};

/** スクロール参照は親が保持し、表示先の復元と新着への追従に共用する。 */
export function ChatConversation({
	state,
	busy,
	send,
	conversation,
	bottom,
	onOpenAgent,
}: {
	state: ChatState;
	busy: boolean;
	send: (message: UiMessage) => void;
	conversation: RefObject<HTMLElement | null>;
	bottom: RefObject<HTMLDivElement | null>;
	onOpenAgent: (agent: SubAgentSummary) => void;
}) {
	return (
		<section
			ref={conversation}
			className="conversation min-h-0 flex-1 overflow-y-auto px-[20px] py-[22px] [scrollbar-width:thin]"
			aria-label="会話"
		>
			{state.messages.length === 0 && (
				<div className="empty-state px-0 pt-[10vh] pb-[30px] text-center">
					<p className="text-[12px] text-muted">
						このワークスペースで作業します
					</p>
					<p className="text-[12px] leading-[1.7] text-muted [overflow-wrap:anywhere]">
						{state.cwd}
					</p>
				</div>
			)}
			<div
				role="log"
				aria-label="メッセージ"
				aria-live="polite"
				aria-relevant="additions text"
			>
				<Messages
					send={send}
					messages={state.messages}
					busy={busy}
					tools={state.tools}
					agents={state.agents.filter(
						(agent) => agent.parentThreadId === state.sessionId,
					)}
					renderAgent={(agent) => (
						<AgentCard
							key={agent.threadId}
							agent={agent}
							onOpen={onOpenAgent}
						/>
					)}
					renderTool={(tool) => (
						<Activity
							key={String(tool.runId) + tool.id}
							state={{
								...state,
								tools: [tool],
								permissions: [],
							}}
							send={send}
						/>
					)}
				/>
			</div>
			<Activity state={{ ...state, tools: [] }} send={send} />
			<PlanDecisionCard state={state} send={send} />
			{state.run === "running" && <ThinkingIndicator />}
			{runLabels[state.run] && (
				<p
					className="run-status my-2 flex items-center gap-1 text-[12px] text-muted"
					role="status"
				>
					{runLabels[state.run]}
					<RunStatusIcon
						kind={state.run === "failed" ? "startled" : "loaf"}
					/>
				</p>
			)}
			<div ref={bottom} />
		</section>
	);
}
