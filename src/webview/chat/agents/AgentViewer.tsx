// 読み取り専用の子スレッドビューと、ネストを一段戻るヘッダーを表示する。
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { UiMessage } from "../../../shared/messages";
import type { ChatState } from "../../../shared/chatState";
import { Messages } from "../messages/Messages";
import { ToolCard } from "../tools/ToolCard";
import { AgentCard, AgentIcon, agentName } from "./AgentCard";
import type { useAgentViewer } from "./useAgentViewer";
import { type AgentThreadView } from "@/shared/subAgents";

/** 親の送信フォームを使わず、閲覧中のスレッドを明示する。 */
export function AgentViewer({
	viewer,
	state,
	send,
}: {
	viewer: ReturnType<typeof useAgentViewer>;
	state: ChatState;
	send?: ((message: UiMessage) => void) | undefined;
}) {
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
			<header className="flex min-w-0 items-center gap-3 border-b border-solid border-message-border p-3">
				<button
					autoFocus
					type="button"
					onClick={viewer.back}
					aria-label="親へ戻る"
					title="親へ戻る"
					className="shrink-0 rounded p-2 hover:bg-message-user focus-visible:outline-2 focus-visible:outline-[var(--vscode-focusBorder)]"
				>
					<ArrowLeft size={18} />
				</button>
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
					className="shrink-0 rounded p-2 disabled:opacity-40"
				>
					<RefreshCw size={16} />
				</button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-width:thin]">
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
		</section>
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
