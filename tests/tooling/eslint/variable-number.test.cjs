// ローカル変数の欠番検出と、関数・ブロックによる判定範囲を固定する。
const { describe, it, test } = require("node:test");
const assert = require("node:assert/strict");
const { RuleTester, ESLint } = require("eslint");
const { parser } = require("typescript-eslint");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser } });
const missing = { messageId: "missingPrevious" };
tester.run(
	"no-skipped-variable-number",
	plugin.rules["no-skipped-variable-number"],
	{
		valid: [
			"function run() { const value = 0; const value2 = 1; const value3 = 2; }",
			"function run() { let value1 = 0, value2 = 1; }",
			"function run() { const value1 = 0; }",
			"const value2 = 0; { let other3 = 1; }",
			"function run(value) { const value2 = 1; }",
			"function run(value1) { const value2 = 1; }",
			"function run() { const value = 0; if (ready) { const value2 = 1; } }",
			"function run() { const value2 = 1; const value = 0; }",
			"function run() { const { key2: value } = source; }",
			"class Example { field2 = 0; static { const value2 = 1; } }",
			"function run() { type value = string; const value1 = 0; const value2 = 1; }",
		],
		invalid: [
			{
				code: 'function connectionMouseCursor(connection) { const matchesConnection2 = !(connection === "ready" || connection === "connecting" || connection === "authenticating"); if (matchesConnection2) { return "cursor-pointer"; } return ""; }',
				errors: [{ ...missing, column: 52 }],
				output: null,
			},
			{ code: "function run() { let value3 = 1; }", errors: [missing] },
			{
				code: "function run() { const value = 0, value3 = 2; }",
				errors: [missing],
			},
			{
				code: "function run() { const value1 = 0, value3 = 2, value4 = 3; }",
				errors: [missing],
			},
			{
				code: "function run() { const value2 = 1, value3 = 2; }",
				errors: [missing],
			},
			{
				code: "const value = 0; function run() { const value2 = 1; }",
				errors: [missing],
			},
			{
				code: "function run() { const value = 0; return () => { const value2 = 1; }; }",
				errors: [missing],
			},
			{
				code: "function run() { { const value = 0; } { const value2 = 1; } }",
				errors: [missing],
			},
			{
				code: "function run() { { const value = 0; } const value2 = 1; }",
				errors: [missing],
			},
			{
				code: "function run() { const { key: value2, other3 } = source; }",
				errors: [missing, missing],
			},
			{
				code: "function run() { const [value2 = 0, ...other3] = source; }",
				errors: [missing, missing],
			},
			{
				code: "const run = () => { const value2 = 1; };",
				errors: [missing],
			},
			{
				code: "class Example { run() { var value2 = 1; } }",
				errors: [missing],
			},
			{
				code: "function run() { for (let value2 of source) {} }",
				errors: [missing],
			},
			{
				code: "function run() { type value = string; const value2 = 1; }",
				errors: [missing],
			},
			{
				code: "function run() { function value() {} const value2 = 1; }",
				errors: [missing],
			},
			{
				code: "function run() { const value9007199254740993 = 0; }",
				errors: [missing],
			},
		],
	},
);

test("製品 Svelte の実効設定で関数内の欠番を検出する", async () => {
	const eslint = new ESLint();
	const [result] = await eslint.lintText(
		'<script lang="ts">function cursor() { const matchesConnection2 = true; return matchesConnection2; }</script>',
		{ filePath: "apps/nerita-ui/src/chat/ChatConversation.svelte" },
	);
	assert.equal(
		result.messages.some((message) => message.fatal),
		false,
	);
	const findings = result.messages.filter(
		(message) => message.ruleId === "nerita/no-skipped-variable-number",
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].severity, 2);
});
