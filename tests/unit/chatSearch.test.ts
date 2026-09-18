// リテラル・単語境界・正規表現の検索条件と、空一致の扱いを確認する。
import { expect, it } from "vitest";
import {
	findMatches,
	searchPattern,
	type FindOptions,
} from "../../src/webview/chat/search/findMatches";

/** 検索設定を部分指定して、純粋な文字列検索を実行する。 */
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
	expect(matches("Power power POWER", "power")).toHaveLength(3);
	expect(
		matches("Power power POWER", "power", { caseSensitive: true }),
	).toHaveLength(1);
	expect(matches("power[1] power1", "power[1]")).toEqual([
		{ start: 0, end: 8 },
	]);
	expect(matches("abc", "")).toEqual([]);
});
it("単語単位はUnicodeとアンダースコアを含む境界を判定する", () => {
	expect(
		matches("power powerful power_1 Power", "power", { wholeWord: true }),
	).toHaveLength(2);
	expect(matches("猫 猫舌 子猫", "猫", { wholeWord: true })).toHaveLength(1);
	expect(matches("e e\u0301", "e", { wholeWord: true })).toHaveLength(1);
});
it("正規表現の範囲・無効な式・空一致・件数上限を扱う", () => {
	expect(
		matches("power1 POWER2 power", "power\\d", { regex: true }),
	).toHaveLength(2);
	expect(() => matches("text", "[", { regex: true })).toThrow();
	expect(matches("abc", "^|$", { regex: true })).toEqual([]);
	expect(findMatches("aaa", /a/gu, 2)).toHaveLength(2);
});
