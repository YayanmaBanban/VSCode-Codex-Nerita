// 宣言の説明と公開境界を検証し、別宣言・本体・解析指示による見逃しを防ぐ。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const svelteParser = require("svelte-eslint-parser");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const rule = plugin.rules["require-declaration-comment"];
const tester = new RuleTester({ languageOptions: { parser } });
tester.run("require-declaration-comment", rule, {
	valid: [
		"/** 未取得の条件は未確定として返す。 */\nfunction conditionValue() {}",
		"// 未指定の条件は未確定として扱う。\nexport type RoutingConditions = Partial<Record<string, boolean>>;",
		"/** 保存前に入力を検証すること。 */\nexport class Store {}",
		"/** 応答が届くまで入力を保持する。 */\nconst save = () => {};",
		"/** 応答が届くまで入力を保持する。 */\nconst save = (() => {}) satisfies Save;",
		"/** 呼び出し元が破棄すること。 */\nconst Store = class {}; export { Store };",
		"/** 保存前に検証すること。 */\ninterface Input { id: string }",
		"/** 保存前に検証すること。 */\nfunction save() {}\nexport { save as commit };",
		"/** 初期化後に使用すること。 */\nfunction read(value: string): string;\nfunction read(value: number): string;\nfunction read(value: string | number) { return String(value); }",
		"/** 初期化後に使用すること。 */\nexport function read(value: string): string;\nexport function read(value: number): string;\nexport function read(value: string | number) { return String(value); }",
		"/** 起動先で実装すること。 */\ndeclare function start(): void;",
		"/** 登録した購読を破棄すること。 */\n@observe\nexport class Store {}",
		"const values = rows.map(row => row.id);",
		"const object = { read() {}, save: () => {} };",
	],
	invalid: [
		{
			code: "export type RoutingConditions = Partial<Record<string, boolean>>;",
			errors: [
				{
					messageId: "public",
					data: { kind: "型", name: "RoutingConditions" },
					line: 1,
					column: 13,
				},
			],
		},
		{
			code: "function conditionValue() {}",
			errors: [
				{
					messageId: "internal",
					data: { kind: "関数", name: "conditionValue" },
					line: 1,
					column: 10,
				},
			],
			output: null,
		},
		{
			code: "export function save() {}",
			errors: [{ messageId: "public" }],
		},
		{
			code: "function save() {} export { save as commit };",
			errors: [{ messageId: "public" }],
		},
		{
			code: "function save() {} export default save;",
			errors: [{ messageId: "public" }],
		},
		{
			code: "const save = () => {}; export { save };",
			errors: [{ messageId: "public" }],
		},
		{
			code: "const save = () => {}, read = () => {}; export { save };",
			errors: [
				{ messageId: "public", data: { kind: "関数", name: "save" } },
				{ messageId: "internal", data: { kind: "関数", name: "read" } },
			],
		},
		{
			code: "const Store = class {};",
			errors: [
				{
					messageId: "internal",
					data: { kind: "クラス", name: "Store" },
				},
			],
		},
		{
			code: "export class Store {}",
			errors: [
				{
					messageId: "public",
					data: { kind: "クラス", name: "Store" },
				},
			],
		},
		{
			code: "type Local = string; interface Public {} export type { Public };",
			errors: [{ messageId: "internal" }, { messageId: "public" }],
		},
		{
			code: "function save() { /* 保存時に検証する。 */ }",
			errors: [{ messageId: "internal" }],
		},
		{
			code: "/** */\nfunction save() {}",
			errors: [{ messageId: "internal" }],
		},
		{
			code: "// @ts-expect-error\nfunction save() {}",
			errors: [{ messageId: "internal" }],
		},
		{
			code: "// prettier-ignore\nfunction save() {}",
			errors: [{ messageId: "internal" }],
		},
		{
			code: "/** @type {Function} */\nconst save = () => {};",
			errors: [{ messageId: "internal" }],
		},
		{
			code: "/** 節の見出し */\n\nfunction save() {}",
			errors: [{ messageId: "internal", line: 3 }],
		},
		{
			code: "const previous = 1; // 前の処理の説明\nfunction save() {}",
			errors: [{ messageId: "internal", line: 2 }],
		},
		{
			code: "/** 保存前に検証すること。 */\nexport function save() { function read() {} }",
			errors: [
				{ messageId: "internal", data: { kind: "関数", name: "read" } },
			],
		},
		{
			code: "/** 保存前に検証すること。 */\nfunction save() { const read = () => {}; }\nexport { save };",
			errors: [{ messageId: "internal" }],
		},
		{
			code: "function read(value: string): string;\nfunction read(value: number): string;\nfunction read(value: string | number) { return String(value); }",
			errors: [{ messageId: "internal", line: 1 }],
		},
		{
			code: "declare function start(): void;",
			errors: [{ messageId: "internal" }],
		},
	],
});

const svelteTester = new RuleTester({
	languageOptions: { parser: svelteParser, parserOptions: { parser } },
});
svelteTester.run("require-declaration-comment (Svelte)", rule, {
	valid: [
		"<script lang='ts'>\n/** 未入力を別の状態として扱う。 */\ntype Input = string;\n/** 編集を確定する前に値を保持する。 */\nfunction save() {}\n</script>",
		"<script module lang='ts'>\n/** 呼び出し元が購読を解除すること。 */\nexport function subscribe() {}\n</script><div />",
		"{#each [] as row}\n<!-- 対象ルールの変更を親へ伝える。 -->\n{@const update = () => row}\n{/each}",
	],
	invalid: [
		{
			code: "{#each [] as row}\n{@const update = () => row}\n{/each}",
			filename: "sample.svelte",
			errors: [{ messageId: "internal", line: 2 }],
		},
		{
			code: "<!-- 入力画面の役割。 -->\n<script lang='ts'>\ntype Input = string;\nfunction save() {}\n</script>",
			filename: "sample.svelte",
			errors: [
				{ messageId: "internal", line: 3 },
				{ messageId: "internal", line: 4 },
			],
		},
		{
			code: "<script module lang='ts'>\nfunction subscribe() {}\nexport { subscribe };\n</script>",
			filename: "sample.svelte",
			errors: [{ messageId: "public", line: 2 }],
		},
	].map((example) => ({ ...example, output: null })),
});
