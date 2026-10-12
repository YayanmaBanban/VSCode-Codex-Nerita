// effect の理由の欠落と、別の処理のコメントによる見逃しを検証する。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser } });
tester.run("require-effect-reason", plugin.rules["require-effect-reason"], {
	valid: [
		"// Bridge の切り替えに合わせて購読を解除する。\n$effect(connect);",
		"/* 子の初期要求より先に購読を登録する。 */\n$effect.pre(connect);",
		"/**\n * 呼び出し側が寿命を管理し、破棄時に購読を解除する。\n */\nconst dispose = $effect.root(connect);",
		"// UI ツリーの外から登録する監視を、明示的な解除関数で管理する。\nexport const dispose = $effect.root(connect);",
		"function attach() { /* DOM の交換に合わせて監視を解除する。 */ $effect(connect); }",
		"function attach() {\n // 呼び出し側の破棄で監視を解除する。\n return $effect.root(connect);\n}",
		"// DOM の取り付け状態を監視し、交換時に解除する。\n$effect(() => {\n // 別の購読は描画前に登録して同期応答を受け取る。\n $effect.pre(connect);\n});",
		"const tracking = $effect.tracking(); const pending = $effect.pending();",
		"other.$effect(connect); other.pre(connect);",
		"function invoke($effect) { $effect(connect); $effect.pre(connect); }",
		"import { $effect } from 'external'; $effect(connect);",
		"const $effect = connect; $effect();",
		"function outer($effect) { return () => $effect.root(connect); }",
	],
	invalid: [
		{
			code: "$effect(connect);",
			errors: [{ messageId: "document", data: { name: "$effect" } }],
			output: null,
		},
		{
			code: "$effect.pre(connect);",
			errors: [{ messageId: "document", data: { name: "$effect.pre" } }],
		},
		{
			code: "const dispose = $effect.root(connect);",
			errors: [{ messageId: "document", data: { name: "$effect.root" } }],
		},
		{
			code: "// Bridge の切り替えに合わせて購読を解除する。\n$effect(connect);\n$effect.pre(connect);",
			errors: [{ messageId: "document", line: 3 }],
		},
		{
			code: "// Bridge の切り替えに合わせて購読を解除する。\n\n$effect(connect);",
			errors: [{ messageId: "document", line: 3 }],
		},
		{
			code: "prepare(); // 別の監視を解除する。\n$effect(connect);",
			errors: [{ messageId: "document", line: 2 }],
		},
		{
			code: "$effect(() => { /* DOM の監視を登録する。 */ connect(); });",
			errors: [{ messageId: "document" }],
		},
		{
			code: "/** */\n$effect(connect);",
			errors: [{ messageId: "document" }],
		},
		{
			code: "// @ts-expect-error\n$effect(connect);",
			errors: [{ messageId: "document" }],
		},
		{
			code: "// eslint-env browser\n$effect(connect);",
			errors: [{ messageId: "document" }],
		},
		{
			code: "// $effect.pre\n$effect.pre(connect);",
			errors: [{ messageId: "document" }],
		},
		{
			code: "const invoke = () => $effect.root(connect);",
			errors: [{ messageId: "document" }],
		},
	],
});
