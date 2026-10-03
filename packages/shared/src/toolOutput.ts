// 出力プレビューと UTF-8 バイト範囲取得の、取得元に依存しない通信契約。
import { isId, isRecord } from "./validation";

export const toolOutputChunkBytes = 64 * 1024;

/** 総量が不明な場合は推測値を設定しない。参照は Host の現在の会話でのみ有効。 */
export type ToolOutputPreview = {
	preview: string;
	truncated: boolean;
	outputRef?: string;
	totalBytes?: number;
};

/** `offset` と `limit` は UTF-8 バイト単位。次の要求には応答の `nextOffset` を使う。 */
export type ToolOutputRequest = {
	type: "tool/output";
	requestId: string;
	outputRef: string;
	offset: number;
	limit: number;
};

/** 文字途中の `offset` は次の文字境界へ進める。`text` は文字が途中で切れない文字列。 */
export type ToolOutputResponse = {
	type: "tool/outputResult";
	requestId: string;
	outputRef: string;
	text: string;
	offset: number;
	nextOffset: number;
	eof: boolean;
	error?: string;
};

/** 不正な範囲や無制限の読み込みを通信境界で拒否する。 */
export function validToolOutputRequest(value: Record<string, unknown>) {
	return (
		isId(value.outputRef) &&
		byteOffset(value.offset) &&
		byteOffset(value.limit) &&
		Number(value.limit) >= 4 &&
		Number(value.limit) <= toolOutputChunkBytes
	);
}

/** 読み込み応答のサイズと前向きのカーソルを検証する。 */
export function validToolOutputResponse(value: Record<string, unknown>) {
	return (
		isId(value.requestId) &&
		isId(value.outputRef) &&
		typeof value.text === "string" &&
		value.text.length <= toolOutputChunkBytes &&
		byteOffset(value.offset) &&
		byteOffset(value.nextOffset) &&
		Number(value.nextOffset) >= Number(value.offset) &&
		typeof value.eof === "boolean" &&
		(value.error === undefined || typeof value.error === "string")
	);
}

/** プレビュー自体にも上限を設け、上限を超える本文の混入を拒否する。 */
export function validToolOutputPreview(value: unknown) {
	return (
		value === undefined ||
		(isRecord(value) &&
			typeof value.preview === "string" &&
			value.preview.length <= 2200 &&
			typeof value.truncated === "boolean" &&
			(value.outputRef === undefined || isId(value.outputRef)) &&
			(value.totalBytes === undefined || byteOffset(value.totalBytes)))
	);
}

/** バイト位置は安全な非負整数に限定する。 */
function byteOffset(value: unknown) {
	return (
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0
	);
}
