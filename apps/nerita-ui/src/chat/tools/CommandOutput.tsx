// Host が制限したプレビューまたは取得範囲をスクロール領域に表示する。
import { cn } from "cnfast";

import { toolOutputClass } from "./toolStyles";

/** Host が制限した出力範囲だけを表示する。 */
export function CommandOutput({ text }: { text: string }) {
	return (
		<pre
			className={cn(
				toolOutputClass,
				"max-h-[400px] overflow-auto rounded-[4px] border border-solid border-panel-border p-[8px]",
			)}
			tabIndex={0}
			aria-label="出力"
		>
			{text}
		</pre>
	);
}
