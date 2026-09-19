// エージェントの状態・アイコン・名前を独立したタイムラインカードで表示する。
import { Check, Circle, LoaderCircle, Square, X } from "lucide-react";
import type { AgentStatus, SubAgentSummary } from "../../../shared/subAgents";
import cheetah from "../../../../media/icons/cheetah_32.svg?raw";
import "../loaders.css";

const icons = { cheetah };
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
		agent.nickname ||
		agent.agentPath.split("/").filter(Boolean).at(-1) ||
		agent.threadId
	);
}
/** 同梱アイコンだけをキーで解決し、サーバー由来のHTMLを挿入しない。 */
export function AgentIcon({
	iconKey,
}: {
	iconKey: SubAgentSummary["iconKey"];
}) {
	return (
		<span
			aria-hidden="true"
			className="block size-8 shrink-0 overflow-hidden rounded-[6px] [&>svg]:size-full"
			dangerouslySetInnerHTML={{ __html: icons[iconKey] }}
		/>
	);
}
/** 実行中だけ回転させ、カード全体をキーボードで開けるようにする。 */
export function AgentCard({
	agent,
	onOpen,
}: {
	agent: SubAgentSummary;
	onOpen: (agent: SubAgentSummary) => void;
}) {
	const Icon =
		agent.status === "running"
			? LoaderCircle
			: agent.status === "completed"
				? Check
				: ["interrupted", "shutdown"].includes(agent.status)
					? Square
					: ["errored", "systemError", "notFound"].includes(
								agent.status,
						  )
						? X
						: Circle;
	return (
		<button
			type="button"
			className="agent-card mb-3 flex w-full min-w-0 items-center gap-3 rounded-[9px] border border-solid border-message-border bg-transparent px-[14px] py-3 text-left text-inherit hover:bg-message-user focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]"
			onClick={() => onOpen(agent)}
			aria-label={`${agentName(agent)}の会話を表示 · ${labels[agent.status]}`}
		>
			<Icon
				size={16}
				aria-hidden="true"
				className={`shrink-0 ${agent.status === "running" ? "tool-progress" : "text-muted"}`}
			/>
			<AgentIcon iconKey={agent.iconKey} />
			<span className="min-w-0 flex-1">
				<span className="block text-[13px] [overflow-wrap:anywhere]">
					{agentName(agent)}
				</span>
				<span className="block text-[12px] text-muted [overflow-wrap:anywhere]">
					{[labels[agent.status], agent.role, agent.model]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</span>
		</button>
	);
}
