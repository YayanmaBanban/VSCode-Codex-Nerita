// 条件式と外側の括弧の改行を禁止し、本体の改行は許可する契約を固定する。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser } });
tester.run(
	"no-multiline-if-condition",
	plugin.rules["no-multiline-if-condition"],
	{
		valid: [
			"if (!ready) { returnFalse(); }",
			"if (!(a < b && b < c)) {}",
			"if (ready) {\n first();\n second();\n}",
			"if (ready)\n{\n first();\n}",
			"if (ready) /* 本体の前のコメント\n 続き */ { work(); }",
			"if (ready) { work(); } else if (!stopped) { retry(); }",
			"while (\n ready\n) { work(); }",
			"function choose() { return (\n left && right\n); }",
			"const busy = items.some(item =>\n ['running', 'stopping'].includes(item.status));\nif (!busy) { stop(); }",
		],
		invalid: [
			{
				code: "if (\n !state.workItems.some(item =>\n ['running', 'stopping'].includes(item.status))\n) { returnState(); }",
				errors: [{ messageId: "singleLine", line: 2, column: 2 }],
				output: null,
			},
			{
				code: "if (\n ready\n) {}",
				errors: [{ messageId: "singleLine", line: 2, column: 2 }],
			},
			{
				code: "if (ready\n) {}",
				errors: [{ messageId: "singleLine", line: 1, column: 5 }],
			},
			{
				code: "if\n(ready) {}",
				errors: [{ messageId: "singleLine", line: 2, column: 2 }],
			},
			{
				code: "if ((\nready\n)) {}",
				errors: [{ messageId: "singleLine", line: 2, column: 1 }],
			},
			{
				code: "if (ready &&\n other) {}",
				errors: [{ messageId: "singleLine", line: 1, column: 5 }],
			},
			{
				code: "if (ready /* 条件の中のコメント\n 続き */) {}",
				errors: [{ messageId: "singleLine", line: 1, column: 5 }],
			},
			{
				code: "if (ready) {} else if (\n retry\n) {}",
				errors: [{ messageId: "singleLine", line: 2, column: 2 }],
			},
		],
	},
);
