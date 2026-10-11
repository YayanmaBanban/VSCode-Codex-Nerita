// エージェントの状態・アイコン・名前を独立したタイムラインカードで表示する。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { cn } from "cnfast";
import type { AgentStatus, SubAgentSummary } from "@nerita/shared/subAgents";
import {
	StatusIndicator,
	type StatusIndicatorState,
} from "../../ui/StatusIndicator";
import { icons } from "./AgentIcons";

const labels: Record<AgentStatus, string> = {
	pendingInit: "準備中",
	running: "実行中",
	idle: "待機中",
	completed: "完了",
	interrupted: "停止",
	shutdown: "停止",
	errored: "エラー",
	systemError: "エラー",
	notFound: "見つかりません",
};

const indicatorStates: Record<AgentStatus, StatusIndicatorState> = {
	pendingInit: "idle",
	running: "running",
	idle: "idle",
	completed: "completed",
	interrupted: "warning",
	shutdown: "warning",
	errored: "error",
	systemError: "error",
	notFound: "error",
};

/** 読み取り待ちでもパス末尾の名前を表示する。 */
export function agentName(agent: SubAgentSummary): string {
	return (
		nonEmptyString(agent.nickname) ??
		nonEmptyString(agent.agentPath.split("/").filter(Boolean).at(-1)) ??
		agent.threadId
	);
}

/** 同梱アイコンだけをキーで解決し、サーバー由来の HTML を挿入しない。 */
export function AgentIcon({
	iconKey,
}: {
	iconKey: SubAgentSummary["iconKey"];
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"block size-8 shrink-0 overflow-hidden rounded-[6px]",
				"[&>svg]:size-full",
			)}
			dangerouslySetInnerHTML={{
				__html: icons[iconKey],
			}}
		/>
	);
}

/** 状態はアイコンで伝え、カード全体をキーボードで開けるようにする。 */
export function AgentCard({
	agent,
	onOpen,
}: {
	agent: SubAgentSummary;
	onOpen: (agent: SubAgentSummary) => void;
}) {
	const chips = [
		agent.role,
		agent.agentPath.split("/").filter(Boolean).at(-1),
		agent.model,
		agent.reasoningEffort,
	].filter(isNonEmptyString);

	return (
		<button
			type="button"
			className={cn(
				"agent-card mb-3 flex w-full min-w-0 items-center gap-3 px-[14px] py-3",
				"rounded-[9px] border border-solid border-message-border bg-transparent",
				"text-left text-inherit",
				"hover:bg-message-user",
				"focus-visible:outline-2 focus-visible:outline-offset-2",
				"focus-visible:outline-focus",
			)}
			onClick={() => onOpen(agent)}
			aria-label={`${agentName(agent)}の会話を表示 · ${labels[agent.status]}`}
		>
			<StatusIndicator status={indicatorStates[agent.status]} />
			<AgentIcon iconKey={agent.iconKey} />
			<span className="min-w-0 flex-1">
				<span className="block text-[13px] [overflow-wrap:anywhere]">
					{agentName(agent)}
				</span>
				<span className="mt-1 flex flex-wrap gap-2 text-[12px]">
					{chips.map((chip, index) => (
						<span
							key={index}
							className={cn(
								"agent-chip max-w-full rounded-[5px] bg-message-code px-2 py-[6px]",
								"leading-none [overflow-wrap:anywhere] text-foreground",
							)}
						>
							{chip}
						</span>
					))}
				</span>
			</span>
		</button>
	);
}
