// ACP の本文・差分・任意の入出力を、実行せずテキストとして表示する。
import type { ToolSummary } from "../../../shared/messages";
import { isRecord } from "../../../shared/validation";

/** 構造が未知の値も欠落させずに表示する。 */
export function Value({ value }: { value: unknown }) {
	return (
		<pre>
			{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
		</pre>
	);
}

/** 編集前後を縦に並べ、狭いサイドバーでも比較可能にする。 */
function Content({ value }: { value: unknown }) {
	if (!isRecord(value)) return <Value value={value} />;
	if (
		value.type === "diff" &&
		typeof value.path === "string" &&
		(value.oldText === null || typeof value.oldText === "string") &&
		typeof value.newText === "string"
	) {
		return (
			<section className="tool-diff">
				<h3>{value.path}</h3>
				<span className="tool-caption">変更前</span>
				<div className="tool-before">
					<Value value={value.oldText ?? "（新規ファイル）"} />
				</div>
				<span className="tool-caption">変更後</span>
				<div className="tool-after">
					<Value value={value.newText || "（空）"} />
				</div>
			</section>
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
				<div className="tool-path" key={path}>
					{path}
				</div>
			))}
			{tool.content?.map((value, index) => (
				<Content key={index} value={value} />
			))}
			{tool.rawInput !== undefined && (
				<section>
					<h3>入力</h3>
					<Value value={tool.rawInput} />
				</section>
			)}
			{tool.rawOutput !== undefined && (
				<section>
					<h3>出力</h3>
					<Value value={tool.rawOutput} />
				</section>
			)}
			{!hasDetails && <p className="muted">詳細はまだありません。</p>}
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
					(value) => isRecord(value) && value.type === "diff",
				)
					? []
					: tool.paths,
			}}
		/>
	);
}
