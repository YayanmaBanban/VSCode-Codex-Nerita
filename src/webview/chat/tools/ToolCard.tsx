// ツールの種別に応じた本文・状態アイコン・停止操作と開閉を表示する。
import { type SetStateAction, type Dispatch, useId, useState } from "react";
import {
	ChevronDown,
	LoaderCircle,
	type LucideIcon,
	Square,
	X,
} from "lucide-react";
import type { ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { taskActive, type AsyncTask } from "../../../shared/asyncTask";
import "../loaders.css";
import type { ActivityToolProps } from "./ActivityToolContent";
import { toolRenderer } from "./toolRenderers";

/** 開閉状態と直前の実行状態を保持する。 */
type CardState = { status: ToolSummary["status"]; open: boolean };

/** 完了への遷移で一度だけ閉じ、完了後の手動展開も許可する。 */
export function ToolCard({
	tool,
	task,
	cancelTurn = false,
	onStop,
	send,
	cwd: workspaceCwd,
}: {
	tool: ToolSummary;
	task?: AsyncTask | undefined;
	cancelTurn?: boolean;
	onStop?: (() => void) | undefined;
} & Pick<ActivityToolProps, "send" | "cwd">) {
	const bodyId = useId();
	const status = cardStatus(tool, task);
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
	const { cwd, command } = toolCommandDetails(tool);
	const active = cardActive(status);
	const { Icon, Body } = toolRenderer(tool);
	const Heading = Body ? "button" : "div";
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
				{renderToolHeading(
					Heading,
					Body,
					state,
					bodyId,
					setState,
					status,
					Icon,
					executing,
					command,
					tool,
					active,
				)}
				{status === "failed" && (
					<span
						className="tool-result absolute right-[30px] inline-flex size-[26px] items-center justify-center text-tool-error"
						role="img"
						aria-label="失敗"
					>
						<X size={16} aria-hidden="true" />
					</span>
				)}
				{executing &&
					active &&
					renderStopButton(tool, onStop, cancelTurn, task)}
			</div>
			{Body &&
				renderToolBody(bodyId, state, Body, tool, send, workspaceCwd)}
		</div>
	);
}

/** 展開中だけツール本文を描画する。 */
function renderToolBody(
	bodyId: string,
	state: CardState,
	body: NonNullable<ReturnType<typeof toolRenderer>["Body"]>,
	tool: ToolSummary,
	send: ActivityToolProps["send"],
	workspaceCwd: ActivityToolProps["cwd"],
) {
	const Body = body;
	return (
		<div
			id={bodyId}
			className="tool-body border-0 border-t border-solid border-panel-border p-[12px] [&_section+section]:mt-[14px]"
			hidden={!state.open}
		>
			{state.open && <Body tool={tool} send={send} cwd={workspaceCwd} />}
		</div>
	);
}

/** 停止操作が必要な待機中または実行中の状態を判定する。 */
function cardActive(status: string) {
	return status === "pending" || status === "in_progress";
}

/** 停止範囲に応じた説明付き停止ボタンを表示する。 */
function renderStopButton(
	tool: ToolSummary,
	onStop: (() => void) | undefined,
	cancelTurn: boolean,
	task: AsyncTask | undefined,
) {
	return (
		<button
			type="button"
			className="tool-stop absolute right-[30px] inline-flex size-[26px] items-center justify-center rounded-[5px] border border-solid border-tool-error/30 bg-tool-error/14 p-0 text-tool-error enabled:hover:bg-tool-error/12"
			aria-label={`${tool.title} を停止`}
			title={stopTitle(Boolean(onStop), cancelTurn, task?.stopPending)}
			disabled={!onStop}
			onClick={onStop}
		>
			<Square size={13} fill="currentColor" aria-hidden="true" />
		</button>
	);
}

/** ツールの開閉見出しと進行状態を表示する。 */
function renderToolHeading(
	heading: "button" | "div",
	body: ReturnType<typeof toolRenderer>["Body"],
	state: CardState,
	bodyId: string,
	setState: Dispatch<SetStateAction<CardState>>,
	status: ToolSummary["status"],
	icon: LucideIcon,
	executing: boolean,
	command: string,
	tool: ToolSummary,
	active: boolean,
) {
	const Heading = heading;
	const Body = body;
	const Icon = icon;
	return (
		<Heading
			className="tool-heading group flex w-full min-w-0 items-center gap-[8px] rounded-none border-0 bg-transparent p-[10px] text-left focus-visible:outline-offset-[-3px] [&_svg]:shrink-0"
			aria-expanded={Body ? state.open : undefined}
			aria-controls={Body ? bodyId : undefined}
			onClick={
				Body ? () => setState({ status, open: !state.open }) : undefined
			}
		>
			<Icon size={16} aria-hidden="true" />
			<span className="tool-title min-w-0 flex-1 [overflow-wrap:anywhere]">
				{executing ? command : tool.title}
			</span>
			{renderExecutionProgress(executing, active)}
			{renderNonExecutionStatus(executing, active, tool)}
			{status === "cancelled" && (
				<span className="tool-status text-[12px] whitespace-nowrap text-muted">
					停止
				</span>
			)}
			{Body && (
				<ChevronDown
					size={14}
					className={`tool-chevron group-aria-[expanded=false]:-rotate-90 ${status === "failed" || (executing && active) ? "ml-[26px]" : ""}`}
					aria-hidden="true"
				/>
			)}
		</Heading>
	);
}

/** 実行ツール以外の待機状態を表示する。 */
function renderNonExecutionStatus(
	executing: boolean,
	active: boolean,
	tool: ToolSummary,
) {
	return (
		!executing &&
		active && (
			<span className="tool-status text-[12px] whitespace-nowrap text-muted">
				{tool.status === "pending" ? "待機中" : "実行中"}
			</span>
		)
	);
}

/** 実行ツールの進行中アイコンを表示する。 */
function renderExecutionProgress(executing: boolean, active: boolean) {
	return (
		executing &&
		active && (
			<LoaderCircle
				size={16}
				className="tool-progress"
				role="img"
				aria-label="実行中"
			/>
		)
	);
}

/** ツール入力から作業フォルダーとコマンド表示を取り出す。 */
function toolCommandDetails(tool: ToolSummary) {
	const input = isRecord(tool.rawInput) ? tool.rawInput : {};
	const action = isRecord(input.action) ? input.action : input;
	const cwd = typeof action.cwd === "string" ? action.cwd : tool.cwd;
	const command = commandLabel(input.command, tool.title);
	return { cwd, command };
}

/** バックグラウンドタスクを優先してカードの実行状態を求める。 */
function cardStatus(
	tool: ToolSummary,
	task: AsyncTask | undefined,
): ToolSummary["status"] {
	if (task) {
		if (taskActive(task)) {
			return "in_progress";
		}
		if (task.state === "failed") {
			return "failed";
		}
		return "completed";
	}
	if (tool.backgrounded) {
		return "in_progress";
	}
	return tool.status;
}

/** 文字列または引数配列のコマンドを表示用に揃える。 */
function commandLabel(command: unknown, title: string) {
	if (typeof command === "string") {
		return command;
	}
	if (Array.isArray(command)) {
		return command.join(" ");
	}
	return title;
}

/** 停止範囲と停止待ち状態に応じた説明を返す。 */
function stopTitle(
	canStop: boolean,
	cancelTurn: boolean,
	stopPending: boolean | undefined,
) {
	if (canStop) {
		if (cancelTurn) {
			return "現在のAI処理全体を停止";
		}
		return "コマンドを停止";
	}
	if (stopPending) {
		return "停止を待っています";
	}
	return "個別停止できるバックグラウンドタスクはありません";
}
