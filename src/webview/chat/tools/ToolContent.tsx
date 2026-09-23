// ツールの本文・差分・任意の入出力を、実行せずテキストとして表示する。
import type { ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { FileDiff } from "./FileDiff";
import { UnifiedDiff } from "./UnifiedDiff";
import { toolLabelClass, toolOutputClass } from "./toolStyles";
import { CommandOutput } from "./CommandOutput";

/** 構造が未知の値も欠落させずに表示する。 */
export function Value({
	value,
	paged = false,
}: {
	value: unknown;
	paged?: boolean;
}) {
	if (paged) {
		return (
			<CommandOutput
				text={
					typeof value === "string"
						? value
						: (JSON.stringify(value, null, 2) ?? "")
				}
			/>
		);
	}
	return (
		<pre className={toolOutputClass}>
			{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
		</pre>
	);
}

/** 専用カードがない項目は、元の構造を省略せずJSONとして表示する。 */
export function RawTool({
	tool,
	paged = false,
}: {
	tool: ToolSummary;
	paged?: boolean;
}) {
	return <Value value={tool.rawItem ?? tool} paged={paged} />;
}

/** ツールの差分と本文を、それぞれ専用の表示に振り分ける。 */
function Content({ value, paged }: { value: unknown; paged: boolean }) {
	if (!isRecord(value)) {
		return <Value value={value} paged={paged} />;
	}
	if (
		value.type === "unifiedDiff" &&
		typeof value.path === "string" &&
		typeof value.diff === "string"
	) {
		return <UnifiedDiff path={value.path} diff={value.diff} />;
	}
	if (isFileDiffContent(value)) {
		return (
			<FileDiff
				path={value.path}
				oldText={value.oldText}
				newText={value.newText}
			/>
		);
	}
	if (
		value.type === "content" &&
		isRecord(value.content) &&
		value.content.type === "text" &&
		typeof value.content.text === "string"
	) {
		return <Value value={value.content.text} paged={paged} />;
	}
	return <Value value={value} paged={paged} />;
}

/** ファイル差分の本文と対象パスを検証する。 */
function isFileDiffContent(value: Record<string, unknown>): value is Record<
	string,
	unknown
> & {
	path: string;
	oldText: string | null;
	newText: string;
} {
	return (
		value.type === "diff" &&
		typeof value.path === "string" &&
		(value.oldText === null || typeof value.oldText === "string") &&
		typeof value.newText === "string"
	);
}

/** 共通表示では本文・対象パス・入出力を表示し、未知の形式も扱う。 */
export function GenericTool({
	tool,
	paged = false,
}: {
	tool: ToolSummary;
	paged?: boolean;
}) {
	const hasDetails =
		!!tool.content?.length ||
		tool.rawInput !== undefined ||
		tool.rawOutput !== undefined;
	return (
		<>
			{tool.paths.map((path) => (
				<div className={`tool-path ${toolLabelClass}`} key={path}>
					{path}
				</div>
			))}
			{tool.content?.map((value, index) => (
				<Content key={index} value={value} paged={paged} />
			))}
			{tool.rawInput !== undefined && (
				<section>
					<h3 className={toolLabelClass}>入力</h3>
					<Value value={tool.rawInput} paged={paged} />
				</section>
			)}
			{tool.rawOutput !== undefined && (
				<section>
					<h3 className={toolLabelClass}>出力</h3>
					<Value value={tool.rawOutput} paged={paged} />
				</section>
			)}
			{!hasDetails && <RawTool tool={tool} paged={paged} />}
		</>
	);
}

/** 編集ツールはファイルごとの差分を優先し、形式が異なる場合は共通表示に戻す。 */
export function EditingFiles({ tool }: { tool: ToolSummary }) {
	return (
		<GenericTool
			tool={{
				...tool,
				paths: tool.content?.some(
					(value) =>
						isRecord(value) &&
						(value.type === "diff" || value.type === "unifiedDiff"),
				)
					? []
					: tool.paths,
			}}
		/>
	);
}

/** 実行カードは停止用の端末参照を隠し、コマンドの入出力を表示する。 */
export function ExecuteTool({ tool }: { tool: ToolSummary }) {
	const output = isRecord(tool.rawOutput)
		? tool.rawOutput.formatted_output
		: undefined;
	if (typeof output === "string") {
		return <CommandOutput text={output} />;
	}
	return (
		<GenericTool
			tool={{
				...tool,
				rawInput: undefined,
				content: (tool.content ?? []).filter(
					(value) => !isRecord(value) || value.type !== "terminal",
				),
			}}
			paged
		/>
	);
}
