// 変更前後の本文を、文脈付きの unified diff として表示する。
import { useMemo } from "react";
import { structuredPatch } from "diff";
import {
	diffLineClass,
	toolCodeClass,
	toolLabelClass,
	toolOutputClass,
} from "./toolStyles";

/** ファイル単位の比較用本文を受け取る。 */
type FileDiffProps = {
	path: string;
	oldText: string | null;
	newText: string;
};

/** 変更の前後3行を残し、追加・削除を記号と背景色で区別する。 */
export function FileDiff({ path, oldText, newText }: FileDiffProps) {
	// 大きく異なる本文でも比較時間を制限し、サイドバーの応答を保つ。
	const patch = useMemo(
		() =>
			structuredPatch(
				path,
				path,
				oldText ?? "",
				newText,
				undefined,
				undefined,
				{ context: 3, timeout: 100 },
			),
		[path, oldText, newText],
	);
	return (
		<section className="tool-diff" aria-label={`${path} の差分`}>
			<h3 className={toolLabelClass}>
				{path}
				{oldText === null && " （新規ファイル）"}
			</h3>
			<DiffBody patch={patch} oldText={oldText} newText={newText} />
		</section>
	);
}

/** 構造化差分の追加行と削除行を色で区別する。 */
function diffLineColor(line: string) {
	if (line.startsWith("+")) {
		return "file-diff-added bg-diff-added";
	}
	if (line.startsWith("-")) {
		return "file-diff-removed bg-diff-removed";
	}
	return "";
}

/** 差分の計算結果に応じて本文・変更なし・差分行を描画する。 */
function DiffBody({
	patch,
	oldText,
	newText,
}: { patch: ReturnType<typeof structuredPatch> | undefined } & Pick<
	FileDiffProps,
	"oldText" | "newText"
>) {
	if (!patch) {
		return (
			<>
				<p className="muted text-[12px] text-muted">
					差分の計算時間を超えたため、本文を表示します。
				</p>
				<h3 className={toolLabelClass}>変更前</h3>
				<pre className={toolOutputClass}>{oldText ?? ""}</pre>
				<h3 className={toolLabelClass}>変更後</h3>
				<pre className={toolOutputClass}>{newText}</pre>
			</>
		);
	}
	if (patch.hunks.length === 0) {
		return (
			<p className="muted text-[12px] text-muted">
				{oldText === null ? "空のファイルを作成" : "変更はありません。"}
			</p>
		);
	}
	return (
		<pre
			className={`file-diff-lines ${toolCodeClass} whitespace-pre [overflow-wrap:normal] overflow-x-auto border border-solid border-panel-border rounded-[4px]`}
			tabIndex={0}
			aria-label="差分コード"
		>
			{patch.hunks.map((hunk, index) => (
				<span key={index}>
					<span
						className={`${diffLineClass} file-diff-hunk text-muted bg-diff-hunk`}
					>{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`}</span>
					{hunk.lines.map((line, lineIndex) => (
						<span
							key={lineIndex}
							className={`${diffLineClass} ${diffLineColor(line)}`}
						>
							{line}
							{"\n"}
						</span>
					))}
				</span>
			))}
		</pre>
	);
}
