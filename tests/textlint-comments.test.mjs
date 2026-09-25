// コメント抽出が構文を区別し、校正結果の行と列を保つことを検証する。
import assert from "node:assert/strict";
import test from "node:test";
import { extractSourceComments } from "../scripts/textlint-comments.mjs";

test("keeps Japanese comments after templates, regexes, and emoji", () => {
	const source = [
		'const emoji = "😀"; // 絵文字の後。',
		"const template = `偽の // コメント ${1 + 2}`;",
		"const regex = /https?:\\/\\/例/; // 正規表現の後。",
		'/** 実際の説明。 */ const value = "文字列の /* 記号 */";',
		'const view = <div title="// 属性">{/* 描画の説明。 */}</div>;',
		"// 最後の説明。",
	].join("\r\n");
	const result = extractSourceComments(source, "fixture.tsx");
	const actual = result.split("\r\n");
	const original = source.split("\r\n");
	for (const [line, comment] of [
		[0, "絵文字の後。"],
		[2, "正規表現の後。"],
		[3, "実際の説明。"],
		[4, "描画の説明。"],
		[5, "最後の説明。"],
	]) {
		assert.equal(actual[line].trim(), comment);
		assert.equal(
			actual[line].indexOf(comment),
			original[line].indexOf(comment),
		);
	}
	assert.equal(actual[1], "");
	assert.equal(actual.length, original.length);
	assert.doesNotMatch(result, /偽の|文字列の|属性/);
	assert.equal(
		extractSourceComments(
			"const view = <div> // 表示する文字列</div>;",
			"fixture.tsx",
		),
		"",
	);
});

test("keeps comments inside expressions and at the end of an empty file", () => {
	const source =
		"function f() { return 1 /* 途中の説明。 */ + 2; } // 末尾の説明。";
	const result = extractSourceComments(source, "fixture.ts");
	for (const comment of ["途中の説明。", "末尾の説明。"]) {
		assert.equal(result.indexOf(comment), source.indexOf(comment));
	}
	assert.equal(
		extractSourceComments("/** 説明。 */", "fixture.ts").trim(),
		"説明。",
	);
	assert.equal(extractSourceComments("// English only", "fixture.ts"), "");
});
