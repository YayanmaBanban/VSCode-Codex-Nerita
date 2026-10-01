// リテラル・単語境界・正規表現の検索条件と、空一致の扱いを確認する。
import { expect, it } from "vitest";
import {
	findMatches,
	searchPattern,
	type FindOptions,
} from "../../apps/nerita-ui/src/chat/search/findMatches";

/** 検索設定を部分指定して、文字列を検索する。 */
function matches(
	text: string,
	query: string,
	options: Partial<FindOptions> = {},
) {
	const pattern = searchPattern(query, {
		caseSensitive: false,
		wholeWord: false,
		regex: false,
		...options,
	});
	return pattern ? findMatches(text, pattern) : [];
}

it("通常検索では記号をそのまま扱い、大文字小文字を切り替える", () => {
	expect(matches("Power power POWER", "power")).toEqual([
		{ start: 0, end: 5 },
		{ start: 6, end: 11 },
		{ start: 12, end: 17 },
	]);
	expect(
		matches("Power power POWER", "power", { caseSensitive: true }),
	).toEqual([{ start: 6, end: 11 }]);
	expect(matches("power[1] power1", "power[1]")).toEqual([
		{ start: 0, end: 8 },
	]);
	expect(matches("abc", "")).toEqual([]);
});
it("単語単位はUnicodeとアンダースコアを含む境界を判定する", () => {
	expect(
		matches("power powerful power_1 Power", "power", { wholeWord: true }),
	).toEqual([
		{ start: 0, end: 5 },
		{ start: 23, end: 28 },
	]);
	expect(matches("猫 猫舌 子猫", "猫", { wholeWord: true })).toEqual([
		{ start: 0, end: 1 },
	]);
	expect(matches("e e\u0301", "e", { wholeWord: true })).toEqual([
		{ start: 0, end: 1 },
	]);
});
it("正規表現の範囲・無効な式・空一致・件数上限を扱う", () => {
	expect(matches("power1 POWER2 power", "power\\d", { regex: true })).toEqual(
		[
			{ start: 0, end: 6 },
			{ start: 7, end: 13 },
		],
	);
	expect(() => matches("text", "[", { regex: true })).toThrow();
	expect(matches("abc", "^|$", { regex: true })).toEqual([]);
	expect(findMatches("aaa", /a/gu, 2)).toEqual([
		{ start: 0, end: 1 },
		{ start: 1, end: 2 },
	]);
});
