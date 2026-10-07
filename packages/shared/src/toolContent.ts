// Host が正規化したツール本文を共有し、Webview での再解釈を不要にする。
import { isRecord } from "./validation";

/** 生の外部データは `rawInput`・`rawOutput`・`rawItem` に保持し、本文には既知の表示形式だけを使う。 */
export type ToolContent =
	| { type: "content"; content: { type: "text"; text: string } }
	| { type: "diff"; path: string; oldText: string | null; newText: string }
	| { type: "unifiedDiff"; path: string; diff: string }
	| { type: "terminal"; terminalId: string };

/** 両バックエンドのプレーンテキストを同じ契約へ変換する。 */
export function textToolContent(
	text: string,
): Extract<ToolContent, { type: "content" }> {
	return { type: "content", content: { type: "text", text } };
}

/** 任意の外部構造を、検証なしに共有本文として受理しない。 */
export function isToolContent(value: unknown): value is ToolContent {
	if (!isRecord(value)) {
		return false;
	}
	switch (value.type) {
		case "content":
			return (
				isRecord(value.content) &&
				value.content.type === "text" &&
				typeof value.content.text === "string"
			);
		case "diff":
			return validFileDiff(value);
		case "unifiedDiff":
			return (
				typeof value.path === "string" && typeof value.diff === "string"
			);
		case "terminal":
			return typeof value.terminalId === "string";
		default:
			return false;
	}
}

/** 変更前の `null` は新規ファイルを表し、変更後の本文は文字列を必須とする。 */
function validFileDiff(value: Record<string, unknown>): boolean {
	return (
		typeof value.path === "string" &&
		(value.oldText === null || typeof value.oldText === "string") &&
		typeof value.newText === "string"
	);
}
