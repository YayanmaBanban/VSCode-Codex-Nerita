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
import type { ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { taskActive, type AsyncTask } from "../../../shared/asyncTask";
import { GuardianReview } from "./GuardianReview";
import { EditingFiles, ExecuteTool, RawTool } from "./ToolContent";
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
	cancelTurn = false,
	onStop,
}: {
	tool: ToolSummary;
	task?: AsyncTask | undefined;
	cancelTurn?: boolean;
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
				: tool.kind === "edit"
					? { Icon: FilePenLine, Body: EditingFiles }
					: (renderers.find(({ titles }) =>
							titles.includes(tool.title.trim().toLowerCase()),
						) ?? { Icon: Wrench, Body: RawTool });
	return (
		<div
			className="tool-card my-[8px] overflow-hidden rounded-[6px] border border-solid border-panel-border"
			data-status={status}
			data-kind={tool.kind}
		>
			{cwd && (
				<div
					className="tool-cwd px-[10px] pt-[8px] text-[12px] text-muted [overflow-wrap:anywhere]"
					title={cwd}
				>
					{cwd}
				</div>
			)}
			<div className="tool-header relative flex items-center">
				<button
					className="tool-heading group flex w-full min-w-0 items-center gap-[8px] rounded-none border-0 bg-transparent p-[10px] text-left focus-visible:outline-offset-[-3px] [&_svg]:shrink-0"
					aria-expanded={state.open}
					aria-controls={bodyId}
					onClick={() => setState({ status, open: !state.open })}
				>
					<Icon size={16} aria-hidden="true" />
					<span className="tool-title min-w-0 flex-1 [overflow-wrap:anywhere]">
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
						<span className="tool-status text-[12px] whitespace-nowrap text-muted">
							{tool.status === "pending" ? "待機中" : "実行中"}
						</span>
					)}
					<ChevronDown
						size={14}
						className={`tool-chevron group-aria-[expanded=false]:-rotate-90 ${status === "failed" || (executing && active) ? "ml-[26px]" : ""}`}
						aria-hidden="true"
					/>
				</button>
				{status === "failed" && (
					<span
						className="tool-result absolute right-[30px] inline-flex size-[26px] items-center justify-center text-tool-error"
						role="img"
						aria-label="失敗"
					>
						<X size={16} aria-hidden="true" />
					</span>
				)}
				{executing && active && (
					<button
						type="button"
						className="tool-stop absolute right-[30px] inline-flex size-[26px] items-center justify-center rounded-[5px] border border-solid border-tool-error/30 bg-tool-error/14 p-0 text-tool-error enabled:hover:bg-tool-error/12"
						aria-label={`${tool.title} を停止`}
						title={
							onStop
								? cancelTurn
									? "現在のAI処理全体を停止"
									: "コマンドを停止"
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
			<div
				id={bodyId}
				className="tool-body border-0 border-t border-solid border-panel-border p-[12px] [&_section+section]:mt-[14px]"
				hidden={!state.open}
			>
				{state.open && <Body tool={tool} />}
			</div>
		</div>
	);
}
