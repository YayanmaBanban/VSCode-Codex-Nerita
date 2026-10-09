// ツールの種別に応じた本文・状態アイコン・停止操作と開閉を表示する。
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";

import { taskActive, type AsyncTask } from "@nerita/shared/asyncTask";
import type { ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import { cn } from "cnfast";
import {
	ChevronDown,
	Check,
	LoaderCircle,
	Square,
	X,
	type LucideIcon,
} from "lucide-react";
import { useId, type Dispatch, type SetStateAction } from "react";
import { useCardExpansion } from "./ToolExpansion";
import "../loaders.css";
import { SettingsTooltip } from "../SettingsTooltip";
import {
	ImageViewTool,
	ThinkTool,
	WebSearchTool,
	type ActivityToolProps,
} from "./ActivityToolContent";
import { ComboListCard } from "./ComboListCard";
import { GenericTool } from "./ToolContent";
import { toolRenderer } from "./toolRenderers";
import { ToolOutputView } from "./ToolOutputView";
import { ToolCardCollapse } from "./ToolCardCollapse";
import { toolLabelClass } from "./toolStyles";
import "./toolCard.css";

/** 実行状態にかかわらず、利用者が選んだ開閉状態を保持する。 */
type CardState = { open: boolean };

/** 保存要約と Host で変換した本文は、汎用のテキスト表示へ渡す。 */
function toolBody(
	tool: ToolSummary,
	renderer: ReturnType<typeof toolRenderer>,
) {
	if (tool.output) {
		return OutputBody;
	}
	if (tool.summaryOnly === true) {
		return ToolHistoryContent;
	}
	return tool.resultDisplay ? GenericTool : renderer.Body;
}

/** 実行状態の更新でも手動の開閉状態を維持する。 */
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
	const executing = tool.kind === "execute";
	const active = cardActive(status);
	const renderer = toolRenderer(tool);
	const Icon = renderer.Icon;
	const Body = toolBody(tool, renderer);
	const comboList = usesComboList(tool, Body);
	const [state, setState] = useCardExpansion(tool);
	if (comboList) {
		return (
			<ComboListCard
				tool={{ ...tool, status }}
				icon={Icon}
				open={state.open}
				bodyId={bodyId}
				onToggle={() => setState({ open: !state.open })}
			>
				<Body tool={tool} send={send} cwd={workspaceCwd} />
			</ComboListCard>
		);
	}
	const Heading = Body ? "button" : "div";
	return (
		<div
			className={cn(
				"tool-card my-[8px] overflow-hidden rounded-[6px] border border-solid",
				"border-panel-border",
			)}
			data-status={status}
			data-kind={tool.kind}
			data-open={state.open}
		>
			<ToolCardHeader
				Heading={Heading}
				Body={Body}
				state={state}
				bodyId={bodyId}
				setState={setState}
				status={status}
				Icon={Icon}
				executing={executing}
				tool={tool}
				active={active}
				onStop={onStop}
				cancelTurn={cancelTurn}
				task={task}
			/>
			{Body && (
				<ToolCardCollapse
					id={bodyId}
					className="tool-card-collapse"
					open={state.open}
				>
					{renderHistoryNotice(tool)}
					{renderToolBody(Body, tool, send, workspaceCwd)}
				</ToolCardCollapse>
			)}
		</div>
	);
}

/** ツールの実行・開閉状態、見出し・本文の描画と停止操作。 */
type ToolCardHeaderProps = {
	Heading: "button" | "div";
	Body: ReturnType<typeof toolRenderer>["Body"];
	state: CardState;
	bodyId: string;
	setState: Dispatch<SetStateAction<CardState>>;
	status: ToolSummary["status"];
	Icon: LucideIcon;
	executing: boolean;
	tool: ToolSummary;
	active: boolean;
	onStop: (() => void) | undefined;
	cancelTurn: boolean;
	task: undefined | AsyncTask;
};

/** ツールの見出し・失敗状態と停止操作を表示する。 */
function ToolCardHeader(props: ToolCardHeaderProps) {
	const {
		Heading,
		Body,
		state,
		bodyId,
		setState,
		status,
		Icon,
		executing,
		tool,
		active,
		onStop,
		cancelTurn,
		task,
	} = props;
	return (
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
				tool,
				active,
			)}
			{status === "failed" && (
				<span
					className={cn(
						"tool-result absolute right-[30px] inline-flex size-[26px] items-center",
						"justify-center text-tool-error",
					)}
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
	);
}

/** 保存要約に残っている入力・本文を持つツール情報。 */
type ToolHistoryContentProps = ActivityToolProps;

/** 保存された入力や本文があれば表示し、保存されていない結果本文は補わない。 */
function ToolHistoryContent({ tool, send, cwd }: ToolHistoryContentProps) {
	return tool.rawInput !== undefined ||
		isNonZeroNumber(tool.content?.length) ? (
		<GenericTool tool={tool} send={send} cwd={cwd} />
	) : null;
}

/** 保存されない本文や入力、省略された子の記録を明示する。 */
function renderHistoryNotice(tool: ToolSummary) {
	if (
		!(tool.summaryOnly === true) &&
		!(tool.nestedCallsIncomplete === true)
	) {
		return null;
	}
	return (
		<div
			className={cn(
				"px-[10px] pb-[8px] text-[12px] [overflow-wrap:anywhere] text-muted",
			)}
		>
			{tool.summaryOnly === true && (
				<p className="m-0">
					保存された要約です。結果本文は保存されていません。
				</p>
			)}
			{tool.omittedArgumentBytes !== undefined && (
				<p className="m-0">
					入力はサイズ制限により省略されています（
					{tool.omittedArgumentBytes} バイト）。
				</p>
			)}
			{tool.nestedCallsIncomplete === true && (
				<p className="m-0">
					入れ子のツール履歴は一部省略されています。
				</p>
			)}
		</div>
	);
}

/** 通常の推論・画像参照・ウェブ検索を縦線付きの開閉表示にまとめる。 */
function usesComboList(
	tool: ToolSummary,
	body: ReturnType<typeof toolRenderer>["Body"],
): body is NonNullable<ReturnType<typeof toolRenderer>["Body"]> {
	if (body === ImageViewTool || body === WebSearchTool) {
		return true;
	}
	return (
		body === ThinkTool &&
		![tool.rawInput, tool.rawOutput].some(
			(value) => isRecord(value) && isRecord(value.review),
		)
	);
}

/** 展開時に使う本文を組み立て、実際の描画と解放は開閉領域に委ねる。 */
function renderToolBody(
	body: NonNullable<ReturnType<typeof toolRenderer>["Body"]>,
	tool: ToolSummary,
	send: ActivityToolProps["send"],
	workspaceCwd: ActivityToolProps["cwd"],
) {
	const Body = body;
	const { cwd, command } = toolCommandDetails(tool);
	return (
		<div
			className={cn(
				"tool-body border-0 border-t border-solid border-panel-border p-[12px]",
				"[&_section+section]:mt-[14px]",
			)}
		>
			{isNonEmptyString(cwd) && (
				<div
					className={cn(
						"tool-cwd mb-[8px] text-[12px] [overflow-wrap:anywhere] text-muted",
					)}
				>
					<span className={toolLabelClass}>CWD</span>
					<div>{cwd}</div>
				</div>
			)}
			{tool.kind === "execute" && (
				<pre
					className={cn(
						"tool-command m-0 mb-[12px] font-mono text-[12px] [overflow-wrap:anywhere]",
						"whitespace-pre-wrap",
					)}
				>
					{command}
				</pre>
			)}
			<Body tool={tool} send={send} cwd={workspaceCwd} />
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
		<SettingsTooltip
			content={stopTitle(Boolean(onStop), cancelTurn, task?.stopPending)}
		>
			<button
				type="button"
				className={cn(
					"tool-stop absolute right-[30px] inline-flex size-[26px] items-center",
					"justify-center p-0",
					"rounded-[5px] border border-solid border-tool-error/30 bg-tool-error/14",
					"text-tool-error",
					"enabled:hover:bg-tool-error/12",
				)}
				aria-label={`${tool.title} を停止`}
				disabled={!onStop}
				onClick={onStop}
			>
				<Square size={13} fill="currentColor" aria-hidden="true" />
			</button>
		</SettingsTooltip>
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
	tool: ToolSummary,
	active: boolean,
) {
	const Heading = heading;
	const Body = body;
	const Icon = icon;
	const title = tool.title;
	// 圧縮はコマンド実行ではないため、停止ボタンを増やさず進行アイコンだけを共用する。
	const progress = usesExecutionProgress(tool);
	return (
		<SettingsTooltip
			content={<span className="whitespace-pre-wrap">{title}</span>}
		>
			<Heading
				className={cn(
					"tool-heading group flex w-full min-w-0 items-center gap-[8px] p-[10px]",
					"[&_svg]:shrink-0",
					"rounded-none border-0 bg-transparent text-left",
					"focus-visible:outline-offset-[-3px]",
					"hover:bg-menu-hover",
					"data-highlighted:bg-menu-hover",
				)}
				aria-expanded={Body ? state.open : undefined}
				aria-controls={Body ? bodyId : undefined}
				onClick={
					Body ? () => setState({ open: !state.open }) : undefined
				}
			>
				<Icon size={16} aria-hidden="true" />
				<span className="tool-title min-w-0 flex-1 truncate">
					{title}
				</span>
				{renderExecutionProgress(progress, active)}
				{renderNonExecutionStatus(progress, active, tool)}
				{renderInactiveStatus(status)}
				{status === "completed" && (
					<Check size={16} role="img" aria-label="完了" />
				)}
				{Body && (
					<ChevronDown
						size={14}
						className={cn(
							"tool-chevron",
							"group-aria-[expanded=false]:-rotate-90",
							status === "failed" || (executing && active)
								? "ml-[26px]"
								: "",
						)}
						aria-hidden="true"
					/>
				)}
			</Heading>
		</SettingsTooltip>
	);
}

/** Host で制限された出力だけを本文に渡す。 */
function OutputBody({ tool, send, cwd }: ActivityToolProps) {
	return tool.output ? (
		<>
			{tool.kind !== "execute" && tool.rawInput !== undefined && (
				<GenericTool tool={tool} send={send} cwd={cwd} />
			)}
			<ToolOutputView output={tool.output} />
			{tool.exitCode !== undefined && (
				<p className="text-[12px] text-muted">
					終了コード: {tool.exitCode}
				</p>
			)}
		</>
	) : null;
}

/** 停止済みと、履歴の完了状態が不明な項目を区別する。 */
function renderInactiveStatus(status: ToolSummary["status"]) {
	if (
		status !== "cancelled" &&
		status !== "unfinished" &&
		status !== "unknown"
	) {
		return null;
	}
	return (
		<span className="tool-status text-[12px] whitespace-nowrap text-muted">
			{
				{
					cancelled: "停止",
					unknown: "結果不明",
					unfinished: "未完了",
				}[status]
			}
		</span>
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

/** コマンド実行に加え、元種別または表示種別がコンテキスト圧縮のカードにも進行アイコンを使う。 */
function usesExecutionProgress(tool: ToolSummary) {
	return (
		tool.kind === "execute" ||
		tool.kind === "contextCompaction" ||
		(isRecord(tool.rawItem) && tool.rawItem.type === "contextCompaction")
	);
}

/** コマンド実行とコンテキスト圧縮の進行中アイコンを表示する。 */
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
	if (tool.backgrounded === true) {
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
	if (stopPending === true) {
		return "停止を待っています";
	}
	return "個別停止できるバックグラウンドタスクはありません";
}
