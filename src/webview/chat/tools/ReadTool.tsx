// 読み取り系ツールの範囲指定と本文を、SDKの生データを見せず表示する。
import type { ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { Value } from "./ToolContent";
import { toolLabelClass } from "./toolStyles";

/** readとlsは同じテキスト出力を使い、MarkdownやHTMLとして実行しない。 */
export function ReadTool({ tool }: { tool: ToolSummary }) {
	const input = isRecord(tool.rawInput) ? tool.rawInput : {};
	const texts = (tool.content ?? []).flatMap((part) => {
		const content = isRecord(part) ? part.content : undefined;
		return isRecord(content) &&
			content.type === "text" &&
			typeof content.text === "string"
			? [content.text]
			: [];
	});
	return (
		<>
			{(typeof input.offset === "number" ||
				typeof input.limit === "number") && (
				<p className={toolLabelClass}>
					{typeof input.offset === "number" &&
						`開始行: ${input.offset} `}
					{typeof input.limit === "number" &&
						`上限: ${input.limit}${tool.kind === "list" ? "件" : "行"}`}
				</p>
			)}
			{texts.length ? (
				<Value value={texts.join("\n\n")} />
			) : (
				<p className={`${toolLabelClass} text-muted`}>
					{emptyOutputMessage(tool.status)}
				</p>
			)}
		</>
	);
}

/** 出力がない場合に実行中・停止・失敗を区別して案内する。 */
function emptyOutputMessage(status: ToolSummary["status"]) {
	if (status === "in_progress" || status === "pending") {
		return "結果を待っています。";
	}
	if (status === "cancelled") {
		return "処理を停止しました。";
	}
	if (status === "failed") {
		return "処理に失敗しました。";
	}
	return "出力はありません。";
}
