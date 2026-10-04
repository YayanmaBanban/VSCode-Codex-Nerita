// Host が制限したプレビューまたは取得範囲をスクロール領域に表示する。
import { cn } from "cnfast";
import { CopyButton } from "../CopyButton";

import { toolOutputClass } from "./toolStyles";

/** 表示中のプレビューまたは一範囲だけをコピーし、未取得の全文は読み込まない。 */
export function CommandOutput({
	text,
	copyDisabled = false,
}: {
	text: string;
	copyDisabled?: boolean;
}) {
	return (
		<div className="relative">
			<pre
				className={cn(
					toolOutputClass,
					"max-h-[400px] overflow-auto rounded-[4px] border border-solid",
					"border-panel-border p-[8px] pr-[44px]",
				)}
				tabIndex={0}
				aria-label="出力"
			>
				{text}
			</pre>
			<CopyButton
				text={text}
				label="出力をコピー"
				disabled={copyDisabled}
				className="absolute top-[5px] right-[20px] size-[28px]"
			/>
		</div>
	);
}
