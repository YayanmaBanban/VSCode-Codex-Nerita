// 貼り付けコードの送信形式と、変換後の参照位置・下書き保持を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	promptContent,
	type ComposerPart,
} from "@nerita/shared/composerContent";

void test("貼り付け部分だけをコードフェンスにし、インデント・末尾空白と下書きを保持する", () => {
	const parts: ComposerPart[] = [
		{ id: "before", type: "text", text: "  前文" },
		{ id: "code", type: "pasted", text: "\treturn 1;  \n\n" },
		{ id: "after", type: "text", text: "後文  " },
	];
	const saved = structuredClone(parts);
	const result = promptContent(
		parts.map((part) => part.text).join(""),
		parts,
	);
	assert.equal(result.text, "前文\n```\n\treturn 1;  \n\n```\n後文");
	assert.deepEqual(result.references, []);
	assert.deepEqual(parts, saved);
});

void test("コード内のフェンスより長いフェンスで囲み、連続するブロックを分ける", () => {
	const parts: ComposerPart[] = [
		{ id: "before", type: "text", text: "" },
		{ id: "first", type: "pasted", text: "```\nexample\n```" },
		{ id: "between", type: "text", text: "" },
		{ id: "second", type: "pasted", text: "next" },
		{ id: "after", type: "text", text: "" },
	];
	assert.equal(
		promptContent(parts.map((part) => part.text).join(""), parts).text,
		"````\n```\nexample\n```\n````\n```\nnext\n```",
	);
});

void test("フェンスと境界改行を加えても、前後の参照を送信本文の正しい位置に保つ", () => {
	const first = {
		kind: "file" as const,
		uri: "fixture:src/first.ts",
		path: "src/first.ts",
		name: "first.ts",
	};
	const last = {
		kind: "file" as const,
		uri: "fixture:src/last.ts",
		path: "src/last.ts",
		name: "last.ts",
	};
	const parts: ComposerPart[] = [
		{
			id: "before",
			type: "text",
			text: "  src/first.ts\n",
			references: [{ offset: 2, path: first }],
		},
		{ id: "code", type: "pasted", text: "  a\nb" },
		{
			id: "after",
			type: "text",
			text: "src/last.ts",
			references: [{ offset: 0, path: last }],
		},
	];
	assert.deepEqual(
		promptContent(parts.map((part) => part.text).join(""), parts),
		{
			text: "src/first.ts\n```\n  a\nb\n```\nsrc/last.ts",
			references: [
				{ offset: 0, path: first },
				{ offset: 27, path: last },
			],
		},
	);
});
