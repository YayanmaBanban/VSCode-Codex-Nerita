// 会話検索の条件を正規表現へ変換し、Unicode の単語境界と空一致を扱う。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";

/** 検索バーから指定する一致条件。 */
export type FindOptions = {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
};
/** テキスト中の一致範囲。末尾は範囲に含まない。 */
export type TextMatch = { start: number; end: number };
export const matchLimit = 10_000;

/** 通常検索は記号をエスケープし、単語単位では日本語や結合文字も区別する。 */
export function searchPattern(
	query: string,
	options: FindOptions,
): RegExp | null {
	if (query === "") {
		return null;
	}
	let source = options.regex
		? query
		: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (options.wholeWord) {
		source = `(?<![\\p{L}\\p{N}\\p{M}_])(?:${source})(?![\\p{L}\\p{N}\\p{M}_])`;
	}
	return new RegExp(source, options.caseSensitive ? "gu" : "giu");
}

/** 空文字列への一致を除外し、大量の一致で描画量が増えすぎないよう件数を上限までに制限する。 */
export function findMatches(
	text: string,
	pattern: RegExp,
	limit = matchLimit,
): TextMatch[] {
	const matches: TextMatch[] = [];
	for (const match of text.matchAll(pattern)) {
		if (!isNonZeroNumber(match[0].length)) {
			continue;
		}
		matches.push({
			start: match.index,
			end: match.index + match[0].length,
		});
		if (matches.length >= limit) {
			break;
		}
	}
	return matches;
}
