// App Server の `unified` `diff` を再計算せず、追加・削除の色で表示する。
import { diffLineClass, toolCodeClass, toolLabelClass } from "./toolStyles";
/** サーバーが返した差分をテキストとして描画する。 */
export function UnifiedDiff({ path, diff }: { path: string; diff: string }) {
	return (
		<section className="tool-diff" aria-label={`${path} の差分`}>
			<h3 className={toolLabelClass}>{path}</h3>
			<pre
				className={`file-diff-lines ${toolCodeClass} whitespace-pre [overflow-wrap:normal] overflow-x-auto border border-solid border-panel-border rounded-[4px]`}
				tabIndex={0}
				aria-label="差分コード"
			>
				{diff.split("\n").map((line, index) => (
					<span
						key={index}
						className={`${diffLineClass} ${diffLineColor(line)}`}
					>
						{line}
						{"\n"}
					</span>
				))}
			</pre>
		</section>
	);
}

/** ファイルヘッダーを除外し、差分の区切り・追加・削除を色分けする。 */
function diffLineColor(line: string) {
	if (line.startsWith("@@")) {
		return "file-diff-hunk text-muted bg-diff-hunk";
	}
	if (line.startsWith("+") && !line.startsWith("+++")) {
		return "file-diff-added bg-diff-added";
	}
	if (line.startsWith("-") && !line.startsWith("---")) {
		return "file-diff-removed bg-diff-removed";
	}
	return "";
}
