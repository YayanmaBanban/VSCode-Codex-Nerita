// 先頭の説明だけを認識し、空コメント・解析指示・本文中の説明による見逃しを防ぐ。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const svelteParser = require("svelte-eslint-parser");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const rule = plugin.rules["require-file-comment"];
const errors = [{ messageId: "document", line: 1, column: 1 }];
const tester = new RuleTester({ languageOptions: { parser } });
tester.run("require-file-comment", rule, {
	valid: [
		"// 入力を検証し、保存用の値へ変換する。\nexport const value = 1;",
		"\n/* 接続先ごとの購読を管理する。 */\nconst value = 1;",
		"/**\n * 接続先ごとの購読を管理する。\n * 終了時に全ての購読を解除する。\n */\nconst value = 1;",
		"\uFEFF// 接続先ごとの購読を管理する。\r\nconst value = 1;",
		"#!/usr/bin/env node\n// 検証用のプロセスを起動する。\nconst value = 1;",
		"// @ts-check\n// 入力を検証し、保存用の値へ変換する。\nconst value = 1;",
		"/* SPDX-License-Identifier: MIT */\n// 接続先ごとの購読を管理する。\nconst value = 1;",
		"/**\n * @ts-check\n * 入力を検証し、保存用の値へ変換する。\n */\nconst value = 1;",
	],
	invalid: [
		"",
		"export const value = 1;",
		"import { value } from './sample';\n// 接続先ごとの購読を管理する。",
		"const value = 1; // 接続先ごとの購読を管理する。",
		"function read() { /* 入力を検証する。 */ }",
		"/* */\nconst value = 1;",
		"/**\n *\n */\nconst value = 1;",
		"// ----\nconst value = 1;",
		"// @ts-check\nconst value = 1;",
		"// eslint-disable-next-line no-unused-vars\nconst value = 1;",
		"// prettier-ignore\nconst value = 1;",
		"/// <reference types='node' />\nconst value = 1;",
		"/* SPDX-License-Identifier: MIT */\nconst value = 1;",
		"#!/usr/bin/env node\nconst value = 1;",
		'const text = "// ファイルの説明";',
	].map((code) => ({ code, errors, output: null })),
});

const svelteTester = new RuleTester({
	languageOptions: { parser: svelteParser, parserOptions: { parser } },
});
svelteTester.run("require-file-comment (Svelte)", rule, {
	valid: [
		"<!-- 入力欄と送信操作をまとめる。 -->\n<script lang='ts'>const value: number = 1;</script><div>{value}</div>",
		"\uFEFF\n<!-- 入力欄と送信操作をまとめる。 -->\r\n<div />",
		"<!-- 入力欄と送信操作をまとめる。 -->\n<script module lang='ts'>export const name = 'chat';</script><div />",
		"<!-- svelte-ignore a11y_no_static_element_interactions -->\n<!-- 入力欄と送信操作をまとめる。 -->\n<div />",
		"<!--\n 入力欄と送信操作をまとめる。\n 保存は呼び出し元に委ねる。\n-->\n<div />",
	].map((code) => ({ code, filename: "sample.svelte" })),
	invalid: [
		"<script lang='ts'>const value: number = 1;</script><div />",
		"<script>\n// 入力欄と送信操作をまとめる。\n</script><div />",
		"<div><!-- 入力欄と送信操作をまとめる。 --></div>",
		"<div />\n<!-- 入力欄と送信操作をまとめる。 -->",
		"<style>/* 入力欄と送信操作をまとめる。 */</style><div />",
		"<!-- -->\n<div />",
		"<!-- svelte-ignore a11y_no_static_element_interactions -->\n<div />",
	].map((code) => ({
		code,
		filename: "sample.svelte",
		errors,
		output: null,
	})),
});
