// 読み取り専用の子スレッドと、親のスレッドへ戻るヘッダーを表示する。

import { cn } from "cnfast";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import {
	type AgentThreadView,
	type SubAgentSummary,
} from "@nerita/shared/subAgents";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Messages } from "../messages/Messages";
import { SettingsTooltip } from "../SettingsTooltip";
import { ToolCard } from "../tools/ToolCard";
import { AgentCard, AgentIcon, agentName } from "./AgentCard";
import { AgentRunControls } from "./AgentRunControls";
import type { useAgentViewer } from "./useAgentViewer";

/** 閲覧中の子スレッドの状態と、親のチャット状態・操作要求の送信関数。 */
type AgentViewerProps = {
	viewer: ReturnType<typeof useAgentViewer>;
	state: ChatState;
	send?: ((message: UiMessage) => void) | undefined;
};

/** 親の送信フォームを使わず、閲覧中のスレッドを明示する。 */
export function AgentViewer({ viewer, state, send }: AgentViewerProps) {
	const { agent, view } = viewer;
	if (!agent) {
		return null;
	}
	const current =
		state.agents.find((item) => item.threadId === agent.threadId) ?? agent;
	const agents = state.agents.filter(
		(item) => item.parentThreadId === agent.threadId,
	);
	return (
		<section
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			aria-label="サブエージェントの会話"
		>
			<AgentViewerHeader viewer={viewer} current={current} />
			<div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto p-5">
				{viewer.error && (
					<div role="alert" className="mb-3 text-[12px]">
						{viewer.error}
						<button
							type="button"
							onClick={viewer.retry}
							className="ml-2 underline"
						>
							再試行
						</button>
					</div>
				)}
				{!view && viewer.loading && (
					<p role="status">会話を読み込んでいます…</p>
				)}
				{view && (
					<Messages
						send={send}
						busy={false}
						messages={view.messages}
						tools={view.tools}
						agents={agents.length ? agents : view.agents}
						renderTool={(tool) => (
							<ToolCard
								key={`${tool.runId}:${tool.id}`}
								tool={tool}
							/>
						)}
						renderAgent={(child) => (
							<AgentCard
								key={child.threadId}
								agent={child}
								onOpen={viewer.open}
							/>
						)}
					/>
				)}
				{emptyAgentView(view) && (
					<p className="text-[12px] text-muted">
						まだ会話はありません。
					</p>
				)}
			</div>
			{send && <AgentRunControls state={state} send={send} />}
		</section>
	);
}

/** 閲覧中のスレッドと、親へ戻る・再読み込みの操作。 */
type AgentViewerHeaderProps = {
	viewer: ReturnType<typeof useAgentViewer>;
	current: SubAgentSummary;
};

/** 閲覧スレッドを示し、親への移動と再読み込みを提供する。 */
function AgentViewerHeader({ viewer, current }: AgentViewerHeaderProps) {
	return (
		<header
			className={cn(
				"flex min-w-0 items-center gap-3 border-b border-solid border-message-border",
				"p-3",
			)}
		>
			<SettingsTooltip content="親へ戻る">
				<button
					autoFocus
					type="button"
					onClick={viewer.back}
					aria-label="親へ戻る"
					className={cn(
						"shrink-0 rounded p-2",
						"hover:bg-message-user",
						"focus-visible:outline-2 focus-visible:outline-focus",
					)}
				>
					<ArrowLeft size={18} />
				</button>
			</SettingsTooltip>
			<AgentIcon iconKey={current.iconKey} />
			<div className="min-w-0 flex-1">
				<span className="block [overflow-wrap:anywhere]">
					{agentName(current)}
				</span>
				<span className="text-[12px] text-muted">閲覧のみ</span>
			</div>
			<button
				type="button"
				onClick={viewer.retry}
				disabled={viewer.loading}
				aria-label="会話を更新"
				className={cn("shrink-0 rounded p-2", "disabled:opacity-40")}
			>
				<RefreshCw size={16} />
			</button>
		</header>
	);
}

/** 読み込み済みの会話に表示項目がないか確認する。 */
function emptyAgentView(view: AgentThreadView | null) {
	return (
		view &&
		!view.messages.length &&
		!view.tools.length &&
		!view.agents.length
	);
}
