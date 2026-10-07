// ツールの本文・差分・任意の入出力はテキストとして表示し、実行しない。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import { cn } from "cnfast";
import type { ToolSummary } from "@nerita/shared/chatState";
import type { ToolContent } from "@nerita/shared/toolContent";
import { FileDiff } from "./FileDiff";
import { UnifiedDiff } from "./UnifiedDiff";
import { toolLabelClass, toolOutputClass } from "./toolStyles";
import { CommandOutput } from "./CommandOutput";
import type { ActivityToolProps } from "./ActivityToolContent";

/** 構造が未知の値も欠落させずに表示する。 */
export function Value({
	value,
	scrollable = false,
}: {
	value: unknown;
	scrollable?: boolean;
}) {
	if (scrollable) {
		const formatted: unknown =
			typeof value === "string" ? value : JSON.stringify(value, null, 2);
		return (
			<CommandOutput
				text={typeof formatted === "string" ? formatted : ""}
			/>
		);
	}
	return (
		<pre className={toolOutputClass}>
			{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
		</pre>
	);
}

/** 専用カードがない項目は、元の構造を省略せず JSON として表示する。 */
export function RawTool({
	tool,
	scrollable = false,
}: {
	tool: ToolSummary;
	scrollable?: boolean;
}) {
	return <Value value={tool.rawItem ?? tool} scrollable={scrollable} />;
}

/** ツールの差分と本文を、それぞれ専用の表示に振り分ける。 */
function Content({
	value,
	scrollable,
	send,
	cwd,
}: {
	value: ToolContent;
	scrollable: boolean;
} & Pick<ActivityToolProps, "send" | "cwd">) {
	if (value.type === "unifiedDiff") {
		return (
			<UnifiedDiff
				path={value.path}
				diff={value.diff}
				send={send}
				cwd={cwd}
			/>
		);
	}
	if (value.type === "diff") {
		return (
			<FileDiff
				path={value.path}
				oldText={value.oldText}
				newText={value.newText}
				send={send}
				cwd={cwd}
			/>
		);
	}
	if (value.type === "content") {
		return <Value value={value.content.text} scrollable={scrollable} />;
	}
	return <Value value={value} scrollable={scrollable} />;
}

/** Host が作った要約には、表示元の説明を添える。 */
function StructuredResultLabel({ tool }: { tool: ToolSummary }) {
	return tool.resultDisplay?.source === "structuredContent" ? (
		<div className={toolLabelClass}>構造化結果</div>
	) : null;
}

/** 共通表示では本文・対象パス・入出力を表示し、未知の形式も扱う。 */
export function GenericTool({
	tool,
	scrollable = false,
	send,
	cwd,
}: {
	tool: ToolSummary;
	scrollable?: boolean;
} & Pick<ActivityToolProps, "send" | "cwd">) {
	const hasDetails =
		isNonZeroNumber(tool.content?.length) ||
		tool.rawInput !== undefined ||
		tool.rawOutput !== undefined;
	return (
		<>
			{tool.paths.map((path) => (
				<div className={cn("tool-path", toolLabelClass)} key={path}>
					{path}
				</div>
			))}
			<StructuredResultLabel tool={tool} />
			{tool.content?.map((value, index) => (
				<Content
					key={index}
					value={value}
					scrollable={scrollable}
					send={send}
					cwd={tool.cwd ?? cwd}
				/>
			))}
			{tool.rawInput !== undefined && (
				<section>
					<h3 className={toolLabelClass}>入力</h3>
					<Value value={tool.rawInput} scrollable={scrollable} />
				</section>
			)}
			{tool.rawOutput !== undefined && (
				<section>
					<h3 className={toolLabelClass}>出力</h3>
					<Value value={tool.rawOutput} scrollable={scrollable} />
				</section>
			)}
			{!hasDetails && <RawTool tool={tool} scrollable={scrollable} />}
		</>
	);
}

/** ファイルごとの差分にパスが表示される場合は、共通表示のパス一覧を省く。 */
export function EditingFiles({ tool, send, cwd }: ActivityToolProps) {
	return (
		<GenericTool
			send={send}
			cwd={cwd}
			tool={{
				...tool,
				paths:
					tool.content?.some(
						(value) =>
							value.type === "diff" ||
							value.type === "unifiedDiff",
					) === true
						? []
						: tool.paths,
			}}
		/>
	);
}

/** 整形済みの出力があれば単独で表示し、それ以外では入力と停止用の端末参照を隠す。 */
export function ExecuteTool({ tool }: { tool: ToolSummary }) {
	const output = tool.commandOutput;
	if (typeof output === "string") {
		return <CommandOutput text={output} />;
	}
	return (
		<GenericTool
			tool={{
				...tool,
				rawInput: undefined,
				content: (tool.content ?? []).filter(
					(value) => value.type !== "terminal",
				),
			}}
			scrollable
		/>
	);
}
