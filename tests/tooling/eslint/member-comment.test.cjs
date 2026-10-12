// メソッドの説明の欠落と、別メンバ・本体・空コメントによる見逃しを固定する。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser } });
tester.run(
	"require-member-function-comment",
	plugin.rules["require-member-function-comment"],
	{
		valid: [
			"class Host {\n /** 選択済みの実行記録を表示へ復元する。 */\n private async attempt() {}\n}",
			"class Host {\n // 監視を開始し、利用者の選択を復元する。\n constructor() {}\n}",
			"class Host {\n /* 実行中のデータだけを公開する。 */\n static snapshot() {}\n}",
			"class Host { /** 実行単位を順に公開する。 */ *runs() {} }",
			"class Host {\n /** 保存境界だけが読み出せる値。 */\n #read() {}\n}",
			"class Host {\n /** 未確定の状態は外へ公開しない。 */\n get value() {}\n /** 確定した値だけを保存する。 */\n set value(next) {}\n}",
			"class Host {\n /** 状態を変更せず、候補だけを通知する。 */\n save = () => {};\n}",
			"class Host {\n /** 呼び出し元の契約を満たす保存処理。 */\n save = (() => {}) satisfies Save;\n}",
			"abstract class Host {\n /** 実装先で保存の完了を待つ。 */\n abstract save(): Promise<void>;\n}",
			"class Host {\n /** 入力の表現だけを切り替え、保存処理は共通にする。 */\n save(value: string): void;\n save(value: number): void;\n save(value: string | number) {}\n}",
			"class Host {\n /** 購読を追加するメソッドだけを装飾する。 */\n @observe\n private async attempt() {}\n}",
			"class Host { value = 0; callback: () => void; }",
			"const object = { attempt() {} };",
			"function attempt() {}",
		],
		invalid: [
			{
				code: "export class DlcHost { private async attempt() {} }",
				errors: [
					{
						messageId: "document",
						data: { name: "attempt" },
						line: 1,
						column: 38,
					},
				],
				output: null,
			},
			{
				code: "class Host { constructor() {} }",
				errors: [
					{
						messageId: "document",
						data: { name: "constructor" },
						line: 1,
						column: 14,
					},
				],
			},
			{
				code: "class Host { static *runs() {} }",
				errors: [
					{
						messageId: "document",
						data: { name: "runs" },
						line: 1,
						column: 22,
					},
				],
			},
			{
				code: "class Host { #read() {} }",
				errors: [
					{
						messageId: "document",
						data: { name: "#read" },
						line: 1,
						column: 14,
					},
				],
			},
			{
				code: "class Host { get value() {} set value(next) {} }",
				errors: [
					{ messageId: "document", line: 1, column: 18 },
					{ messageId: "document", line: 1, column: 33 },
				],
			},
			{
				code: "class Host { save = () => {}; }",
				errors: [
					{
						messageId: "document",
						data: { name: "save" },
						line: 1,
						column: 14,
					},
				],
			},
			{
				code: "class Host { save = function() {}; }",
				errors: [{ messageId: "document", line: 1, column: 14 }],
			},
			{
				code: "class Host { attempt() { /* 本体の説明だけ */ } }",
				errors: [{ messageId: "document", line: 1, column: 14 }],
			},
			{
				code: "/** クラス全体の責務 */\nclass Host { attempt() {} }",
				errors: [{ messageId: "document", line: 2, column: 14 }],
			},
			{
				code: "class Host {\n /** 前のメンバの説明 */\n previous() {} // 前のメンバの後始末\n attempt() {}\n}",
				errors: [{ messageId: "document", line: 4, column: 2 }],
			},
			{
				code: "class Host {\n /** */\n attempt() {}\n}",
				errors: [{ messageId: "document", line: 3, column: 2 }],
			},
			{
				code: "class Host {\n // @ts-expect-error\n attempt() {}\n}",
				errors: [{ messageId: "document", line: 3, column: 2 }],
			},
			{
				code: "abstract class Host { abstract save(): void; }",
				errors: [{ messageId: "document", line: 1, column: 32 }],
			},
			{
				code: "class Host { save(value: string): void; save(value: number): void; save(value: string | number) {} }",
				errors: [{ messageId: "document", line: 1, column: 14 }],
			},
			{
				code: "class Host {\n /** 節の見出し */\n\n attempt() {}\n}",
				errors: [{ messageId: "document", line: 4, column: 2 }],
			},
		],
	},
);
