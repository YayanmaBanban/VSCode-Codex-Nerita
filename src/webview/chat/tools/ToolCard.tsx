// ツールの種別に応じた本文・状態アイコン・停止操作と開閉を表示する。
import { useId, useState } from "react";
import {
	ChevronDown,
	FilePenLine,
	Sprout,
	ShieldCheck,
	Wrench,
	Terminal,
	LoaderCircle,
	Square,
	X,
} from "lucide-react";
import type { ToolSummary } from "../../../shared/messages";
import { isRecord } from "../../../shared/validation";
import { taskActive, type AsyncTask } from "../../../shared/asyncTask";
import { GuardianReview } from "./GuardianReview";
import { EditingFiles, ExecuteTool, GenericTool } from "./ToolContent";
import "./tools.css";
import "../loaders.css";

// 専用表示を追加するときは、ここへタイトルとアイコン・本文を登録する。
const renderers = [
	{
		titles: ["editing files", "editing file", "editng file"],
		Icon: FilePenLine,
		Body: EditingFiles,
	},
];

/** 完了への遷移で一度だけ閉じ、完了後の手動展開も許可する。 */
export function ToolCard({
	tool,
	task,
	onStop,
}: {
	tool: ToolSummary;
	task?: AsyncTask | undefined;
	onStop?: (() => void) | undefined;
}) {
	const bodyId = useId();
	const status = task
		? taskActive(task)
			? "in_progress"
			: task.state === "failed"
				? "failed"
				: "completed"
		: tool.backgrounded
			? "in_progress"
			: tool.status;
	const [state, setState] = useState({
		status,
		open: status !== "completed",
	});
	if (state.status !== status) {
		setState({
			status,
			open: status === "completed" ? false : state.open,
		});
	}
	const executing = tool.kind === "execute";
	const input = isRecord(tool.rawInput) ? tool.rawInput : {};
	const action = isRecord(input.action) ? input.action : input;
	const cwd = typeof action.cwd === "string" ? action.cwd : tool.cwd;
	const command =
		typeof input.command === "string"
			? input.command
			: Array.isArray(input.command)
				? input.command.join(" ")
				: tool.title;
	const active = status === "pending" || status === "in_progress";
	// Guardian Review は think の場合も専用の盾アイコンを維持する。
	const guardian = tool.title.trim().toLowerCase() === "guardian review";
	const { Icon, Body } = guardian
		? { Icon: ShieldCheck, Body: GuardianReview }
		: tool.kind === "think"
			? { Icon: Sprout, Body: GuardianReview }
			: executing
				? { Icon: Terminal, Body: ExecuteTool }
				: (renderers.find(({ titles }) =>
						titles.includes(tool.title.trim().toLowerCase()),
					) ?? { Icon: Wrench, Body: GenericTool });
	return (
		<div className="tool-card" data-status={status} data-kind={tool.kind}>
			{cwd && (
				<div className="tool-cwd" title={cwd}>
					{cwd}
				</div>
			)}
			<div className="tool-header">
				<button
					className="tool-heading"
					aria-expanded={state.open}
					aria-controls={bodyId}
					onClick={() => setState({ status, open: !state.open })}
				>
					<Icon size={16} aria-hidden="true" />
					<span className="tool-title">
						{executing ? command : tool.title}
					</span>
					{executing && active && (
						<LoaderCircle
							size={16}
							className="tool-progress"
							role="img"
							aria-label="実行中"
						/>
					)}
					{!executing && active && (
						<span className="tool-status">
							{tool.status === "pending" ? "待機中" : "実行中"}
						</span>
					)}
					<ChevronDown
						size={14}
						className="tool-chevron"
						aria-hidden="true"
					/>
				</button>
				{status === "failed" && (
					<span className="tool-result" role="img" aria-label="失敗">
						<X size={16} aria-hidden="true" />
					</span>
				)}
				{executing && active && (
					<button
						type="button"
						className="tool-stop"
						aria-label={`${tool.title} を停止`}
						title={
							onStop
								? "コマンドを停止"
								: task?.stopPending
									? "停止を待っています"
									: "個別停止できるバックグラウンドタスクはありません"
						}
						disabled={!onStop}
						onClick={onStop}
					>
						<Square
							size={13}
							fill="currentColor"
							aria-hidden="true"
						/>
					</button>
				)}
			</div>
			<div id={bodyId} className="tool-body" hidden={!state.open}>
				{state.open && <Body tool={tool} />}
			</div>
		</div>
	);
}
