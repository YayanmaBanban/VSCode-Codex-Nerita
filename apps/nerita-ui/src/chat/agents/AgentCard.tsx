// エージェントの状態・アイコン・名前を独立したタイムラインカードで表示する。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { cn } from "cnfast";
import { Check, LoaderCircle, X } from "lucide-react";
import type { AgentStatus, SubAgentSummary } from "@nerita/shared/subAgents";
import { icons } from "./AgentIcons";
import "../loaders.css";

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
			<AgentStatusIndicator status={agent.status} />
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

/** 待機と停止は色だけを変えて同じパルスを使い、状態名はカードの読み上げに残す。 */
function AgentStatusIndicator({ status }: { status: AgentStatus }) {
	if (status === "running") {
		return (
			<LoaderCircle
				size={16}
				aria-hidden="true"
				className="tool-progress shrink-0"
			/>
		);
	}
	if (status === "completed") {
		return (
			<Check
				size={16}
				aria-hidden="true"
				className="shrink-0 text-menu-check"
			/>
		);
	}
	if (["errored", "systemError", "notFound"].includes(status)) {
		return (
			<X
				size={16}
				aria-hidden="true"
				className="shrink-0 text-tool-error"
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={cn(
				"agent-status-dots flex h-4 w-4 shrink-0 items-center justify-between",
				status === "interrupted" || status === "shutdown"
					? "text-warning"
					: "text-white",
			)}
		>
			<span className="size-1 rounded-full bg-current" />
			<span className="size-1 rounded-full bg-current" />
			<span className="size-1 rounded-full bg-current" />
		</span>
	);
}
