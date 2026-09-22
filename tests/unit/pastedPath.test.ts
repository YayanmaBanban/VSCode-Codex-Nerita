// 行番号形式の変換と、送信・復元時の範囲保持を確認する。
import { expect, it } from "vitest";
import { parsePastedPath } from "../../src/shared/pastedPath";
import { pathText, validReferences } from "../../src/shared/composerReferences";

it.each([
	["D:/test.ts:20:1", 19, 0, 19, 0],
	["D:/test.ts:20", 19, 0, 19, 0],
	["D:/test.ts:20:2-100:5", 19, 1, 99, 4],
	["D:/test.ts:20:1 (usePastedPath())", 19, 0, 19, 0],
	['"D:/test.ts":1:2', 0, 1, 0, 1],
	["D:/test.ts(0:100)", 0, 0, 100, 0],
] as const)(
	"位置を抽出する: %s",
	(text, line, character, endLine, endCharacter) => {
		expect(parsePastedPath(text)).toEqual({
			path: "D:/test.ts",
			range: {
				start: { line, character },
				end: { line: endLine, character: endCharacter },
			},
		});
	},
);

it.each([
	"D:/test.ts:0:1",
	"D:/test.ts:1:0",
	"D:/test.ts:20-10",
	"D:/test.ts(100:0)",
	"D:/test.ts:9999999999999",
	"relative.ts:1:1",
	"code\ncode",
])("不正な位置を拒否する: %s", (text) => {
	expect(parsePastedPath(text)).toBeNull();
});

it("通常パスを維持し、範囲の列も送信・コピーで保持する", () => {
	expect(parsePastedPath('"D:/a b.ts"')).toEqual({ path: "D:/a b.ts" });
	const target = parsePastedPath("D:/test.ts:20:2-100:5")!;
	const path = {
		...target,
		uri: "file:///D:/test.ts",
		name: "test.ts",
		kind: "file" as const,
	};
	expect(pathText(path)).toBe("D:/test.ts:20:2-100:5");
	expect(validReferences(pathText(path), [{ offset: 0, path }])).toBe(true);
});
