import assert from "node:assert/strict";
import test from "node:test";

import { findEnglishTermIssues } from "../scripts/textlint-terms.mjs";

const config = {
	allowedEnglish: ["API", "TypeScript"],
	preferredJapanese: {
		owner: "担当テスト",
	},
};

test("classifies bare English while ignoring code, URLs, links, and allowed terms", () => {
	const items = [
		{
			file: "docs/policy.md",
			startLine: 10,
			endLine: 15,
			kind: "document",
			text: [
				"既存の owner を使う。",
				"未知の fooBar を確認する。",
				"`role` を正規化する。",
				"API と TypeScript を使う。",
				"詳細は https://example.com/fooBar を参照する。",
				"[UI レビュー](UI-Review-Guide.md) を参照する。",
			].join("\n"),
		},
	];

	assert.deepEqual(findEnglishTermIssues(items, config), [
		{
			file: "docs/policy.md",
			line: 10,
			type: "preferred-japanese",
			term: "owner",
			suggestion: "担当テスト",
			text: "既存の owner を使う。",
		},
		{
			file: "docs/policy.md",
			line: 11,
			type: "unknown-english",
			term: "fooBar",
			suggestion: null,
			text: "未知の fooBar を確認する。",
		},
		{
			file: "docs/policy.md",
			line: 15,
			type: "unknown-english",
			term: "UI",
			suggestion: null,
			text: "[UI レビュー](UI-Review-Guide.md) を参照する。",
		},
	]);
});
