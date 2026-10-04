// 変更前後の本文から文脈付きの差分を作り、共通の行番号付き表示に渡す。
import { useMemo } from "react";
import { structuredPatch } from "diff";
import { DiffView, type DiffLocationProps } from "./DiffView";
import { toolLabelClass, toolOutputClass } from "./toolStyles";

/** null は新規ファイルを表し、空の変更前本文とは区別する。 */
type FileDiffProps = DiffLocationProps & {
	oldText: string | null;
	newText: string;
};

/** 大きく異なる本文でも差分計算に時間制限を設け、サイドバーの応答を保つ。 */
export function FileDiff({ oldText, newText, ...location }: FileDiffProps) {
	const { path } = location;
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
		<DiffView {...location} hunks={patch?.hunks}>
			{!patch ? (
				<>
					<p className="text-[12px] text-muted">
						差分の計算時間を超えたため、本文を表示します。
					</p>
					<h3 className={toolLabelClass}>変更前</h3>
					<pre className={toolOutputClass}>{oldText ?? ""}</pre>
					<h3 className={toolLabelClass}>変更後</h3>
					<pre className={toolOutputClass}>{newText}</pre>
				</>
			) : (
				patch.hunks.length === 0 && (
					<p className="text-[12px] text-muted">
						{oldText === null
							? "空のファイルを作成"
							: "変更はありません。"}
					</p>
				)
			)}
		</DiffView>
	);
}
