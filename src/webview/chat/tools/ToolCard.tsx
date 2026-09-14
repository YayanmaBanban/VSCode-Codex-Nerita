// ツールごとの開閉状態を管理し、タイトルに対応した本文を表示する。
import { useId, useState } from "react";
import { ChevronDown, FilePenLine, ShieldCheck, Wrench } from "lucide-react";
import type { ToolSummary } from "../../../shared/messages";
import { GuardianReview } from "./GuardianReview";
import { EditingFiles, GenericTool } from "./ToolContent";
import "./tools.css";

// 専用表示を追加するときは、ここへタイトルとアイコン・本文を登録する。
const renderers = [
	{ titles: ["guardian review"], Icon: ShieldCheck, Body: GuardianReview },
	{
		titles: ["editing files", "editing file", "editng file"],
		Icon: FilePenLine,
		Body: EditingFiles,
	},
];
const labels = {
	pending: "待機中",
	in_progress: "実行中",
	completed: "完了",
	failed: "失敗",
};

/** 完了への遷移で一度だけ閉じ、完了後の手動展開も許可する。 */
export function ToolCard({ tool }: { tool: ToolSummary }) {
	const bodyId = useId();
	const [state, setState] = useState({
		status: tool.status,
		open: tool.status !== "completed",
	});
	if (state.status !== tool.status) {
		setState({
			status: tool.status,
			open: tool.status === "completed" ? false : state.open,
		});
	}
	const { Icon, Body } = renderers.find(({ titles }) =>
		titles.includes(tool.title.trim().toLowerCase()),
	) ?? { Icon: Wrench, Body: GenericTool };
	return (
		<div className="tool-card" data-status={tool.status}>
			<button
				className="tool-heading"
				aria-expanded={state.open}
				aria-controls={bodyId}
				onClick={() =>
					setState({ status: tool.status, open: !state.open })
				}
			>
				<Icon size={16} aria-hidden="true" />
				<span className="tool-title">{tool.title}</span>
				<span className="tool-status">{labels[tool.status]}</span>
				<ChevronDown
					size={14}
					className="tool-chevron"
					aria-hidden="true"
				/>
			</button>
			<div id={bodyId} className="tool-body" hidden={!state.open}>
				{state.open && <Body tool={tool} />}
			</div>
		</div>
	);
}
