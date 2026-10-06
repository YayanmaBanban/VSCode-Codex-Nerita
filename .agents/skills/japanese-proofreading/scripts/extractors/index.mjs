// 拡張子からコメント・文字列・識別子の抽出処理を選ぶ。
import path from "node:path";
import * as typeScript from "./typeScript.mjs";
import * as rust from "./rust.mjs";

const extractors = new Map([
	...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
		(extension) => [extension, typeScript],
	),
	[".rs", rust],
]);

export const SOURCE_EXTENSIONS = new Set(extractors.keys());

/** 未対応の言語を検査済みと扱わない。 */
function extractorFor(filePath) {
	const extractor = extractors.get(path.extname(filePath).toLowerCase());
	if (!extractor) {
		throw new Error(`Unsupported source language: ${filePath}`);
	}
	return extractor;
}

/** 元の位置を保持した検査用本文とレビュー項目を返す。 */
export function extractSourceComments(source, filePath) {
	return extractorFor(filePath).extractSourceComments(source, filePath);
}

/** 日本語を含む文字列の固定部分を抽出する。Rust の文字列抽出には未対応のため空配列を返す。 */
export function extractSourceTexts(source, filePath) {
	return extractorFor(filePath).extractSourceTexts?.(source, filePath) ?? [];
}

/** バッククォート不足の検査に使う識別子を集める。 */
export function extractSourceIdentifiers(source, filePath) {
	return extractorFor(filePath).extractSourceIdentifiers(source, filePath);
}
