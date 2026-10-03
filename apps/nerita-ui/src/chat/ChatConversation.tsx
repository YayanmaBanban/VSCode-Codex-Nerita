// 会話ログ・ツール・承認と実行状態を1つのスクロール領域に配置する。

import { cn } from "cnfast";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import type { SubAgentSummary } from "@nerita/shared/subAgents";
import type { RefObject } from "react";
import { Activity } from "./Activity";
import { AgentCard } from "./agents/AgentCard";
import { Messages } from "./messages/Messages";
import { PlanDecisionCard } from "./PlanDecisionCard";
import { RunStatusIcon } from "./RunStatusIcon";
import { ThinkingIndicator } from "./ThinkingIndicator";

const runLabels = {
	idle: "",
	running: "",
	cancelling: "停止しています…",
	completed: "",
	cancelled: "停止しました",
	failed: "実行に失敗しました",
};

/** 会話の表示状態、スクロール用の DOM 参照と子スレッドを開く操作。 */
type ChatConversationProps = {
	state: ChatState;
	busy: boolean;
	send: (message: UiMessage) => void;
	conversation: RefObject<HTMLElement | null>;
	bottom: RefObject<HTMLDivElement | null>;
	onOpenAgent: (agent: SubAgentSummary) => void;
};

/** スクロール参照は親が保持し、表示先の復元と新着への追従に共用する。 */
export function ChatConversation(props: ChatConversationProps) {
	const { state, send, conversation, bottom } = props;
	return (
		<section
			ref={conversation}
			className={cn(
				"conversation min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto",
				"px-[20px] py-[22px]",
			)}
			aria-label="会話"
		>
			{state.messages.length === 0 && (
				<div className="empty-state px-0 pt-[10vh] pb-[30px] text-center">
					<p className="text-[12px] text-muted">
						このワークスペースで作業します
					</p>
					<p
						className={cn(
							"text-[12px] leading-[1.7] [overflow-wrap:anywhere] text-muted",
						)}
					>
						{state.cwd}
					</p>
				</div>
			)}
			<ConversationMessages {...props} />
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

/** 会話に属するメッセージ・ツール・子スレッドの状態と操作。 */
type ConversationMessagesProps = {
	send: (message: UiMessage) => void;
	state: ChatState;
	busy: boolean;
	onOpenAgent: (agent: SubAgentSummary) => void;
};

/** 会話に属するツールと子スレッドをメッセージへ対応付ける。 */
function ConversationMessages({
	send,
	state,
	busy,
	onOpenAgent,
}: ConversationMessagesProps) {
	return (
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
	);
}
