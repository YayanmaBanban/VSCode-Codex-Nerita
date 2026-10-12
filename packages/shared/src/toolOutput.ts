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

/** UTF-8 文字の途中を指す `offset` は次の文字境界へ進める。`text` は文字が途中で切れない文字列。 */
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
	if (!isId(value.outputRef)) {
		return false;
	}
	if (!byteOffset(value.offset)) {
		return false;
	}
	if (!byteOffset(value.limit)) {
		return false;
	}
	return (
		Number(value.limit) >= 4 && Number(value.limit) <= toolOutputChunkBytes
	);
}

/** 読み込み応答の文字数と、バイト位置が戻らないことを検証する。 */
export function validToolOutputResponse(value: Record<string, unknown>) {
	if (!isId(value.requestId)) {
		return false;
	}
	if (!isId(value.outputRef)) {
		return false;
	}
	if (!(typeof value.text === "string")) {
		return false;
	}
	const matchesLength = !(
		value.text.length <= toolOutputChunkBytes &&
		byteOffset(value.offset) &&
		byteOffset(value.nextOffset)
	);
	if (matchesLength) {
		return false;
	}

	if (!(Number(value.nextOffset) >= Number(value.offset))) {
		return false;
	}
	if (!(typeof value.eof === "boolean")) {
		return false;
	}
	return value.error === undefined || typeof value.error === "string";
}

/** プレビュー自体にも上限を設け、上限を超える本文の混入を拒否する。 */
export function validToolOutputPreview(value: unknown) {
	if (value === undefined) {
		return true;
	}

	if (!isRecord(value)) {
		return false;
	}
	if (!(typeof value.preview === "string")) {
		return false;
	}
	if (!(value.preview.length <= 2200)) {
		return false;
	}

	if (!(typeof value.truncated === "boolean")) {
		return false;
	}
	if (!(value.outputRef === undefined || isId(value.outputRef))) {
		return false;
	}
	return value.totalBytes === undefined || byteOffset(value.totalBytes);
}

/** バイト位置は安全な非負整数に限定する。 */
function byteOffset(value: unknown) {
	return (
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0
	);
}
