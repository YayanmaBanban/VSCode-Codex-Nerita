// ツールの本文・差分・任意の入出力を、実行せずテキストとして表示する。
import type { ToolSummary } from "../../../shared/messages";
import { isRecord } from "../../../shared/validation";
import { FileDiff } from "./FileDiff";
import { UnifiedDiff } from "./UnifiedDiff";
import { toolLabelClass, toolOutputClass } from "./toolStyles";

/** 構造が未知の値も欠落させずに表示する。 */
export function Value({ value }: { value: unknown }) {
	return (
		<pre className={toolOutputClass}>
			{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
		</pre>
	);
}

/** 専用カードがない項目は、元の構造を省略せずJSONとして表示する。 */
export function RawTool({ tool }: { tool: ToolSummary }) {
	return <Value value={tool.rawItem ?? tool} />;
}

/** ツールの差分と本文を、それぞれ専用の表示に振り分ける。 */
function Content({ value }: { value: unknown }) {
	if (!isRecord(value)) {
		return <Value value={value} />;
	}
	if (
		value.type === "unifiedDiff" &&
		typeof value.path === "string" &&
		typeof value.diff === "string"
	) {
		return <UnifiedDiff path={value.path} diff={value.diff} />;
	}
	if (
		value.type === "diff" &&
		typeof value.path === "string" &&
		(value.oldText === null || typeof value.oldText === "string") &&
		typeof value.newText === "string"
	) {
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
		return <Value value={value.content.text} />;
	}
	return <Value value={value} />;
}

/** 共通表示では本文・対象パス・入出力を表示し、未知の形式も扱う。 */
export function GenericTool({ tool }: { tool: ToolSummary }) {
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
				<Content key={index} value={value} />
			))}
			{tool.rawInput !== undefined && (
				<section>
					<h3 className={toolLabelClass}>入力</h3>
					<Value value={tool.rawInput} />
				</section>
			)}
			{tool.rawOutput !== undefined && (
				<section>
					<h3 className={toolLabelClass}>出力</h3>
					<Value value={tool.rawOutput} />
				</section>
			)}
			{!hasDetails && <RawTool tool={tool} />}
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
		return <Value value={output} />;
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
		/>
	);
}
