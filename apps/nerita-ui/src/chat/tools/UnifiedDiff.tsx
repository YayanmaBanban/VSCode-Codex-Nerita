// App Server の unified diff を解析し、差分を再計算せずに行番号付きで表示する。
import { parsePatch } from "diff";
import { useMemo } from "react";
import { DiffView, type DiffLocationProps } from "./DiffView";
import { toolOutputClass } from "./toolStyles";

/** 解釈できない差分でも元の本文を残し、ファイルを比較する操作を提供する。 */
export function UnifiedDiff({
	diff,
	...location
}: DiffLocationProps & { diff: string }) {
	const hunks = useMemo(() => {
		try {
			return parsePatch(diff).flatMap((patch) => patch.hunks);
		} catch {
			return [];
		}
	}, [diff]);
	return (
		<DiffView {...location} hunks={hunks.length > 0 ? hunks : undefined}>
			{hunks.length === 0 && (
				<pre className={toolOutputClass}>{diff}</pre>
			)}
		</DiffView>
	);
}
