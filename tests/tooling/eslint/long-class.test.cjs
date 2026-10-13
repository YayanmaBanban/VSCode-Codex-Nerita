// class の文字数境界・文字列式・動的な値の扱いを Svelte パーサーで検証する。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const svelteParser = require("svelte-eslint-parser");
const plugin = require("../../../config/eslint/index.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
	languageOptions: { parser: svelteParser, parserOptions: { parser } },
});
const rule = plugin.rules["require-cn-for-long-class"];
const boundary = "a".repeat(120);
const overLimit = "a".repeat(121);

tester.run("require-cn-for-long-class", rule, {
	valid: [
		'<div class="flex gap-2" />',
		`<div class="${boundary}" />`,
		`<div class={"${boundary}"} />`,
		`<div class={\`${boundary}\`} />`,
		`<div class="\n  ${boundary}\n  " />`,
		'<div class=" flex\n\t\tgap-2 " />',
		"<div class />",
		"<div class:active={active} />",
		"<div class={classes} />",
		`<div title="${overLimit}" />`,
		`<script>const text = "${overLimit}";</script>`,
		`<div class={cn("${"a".repeat(60)}", "${"b".repeat(60)}")} />`,
		'<div class={active ? "flex" : "hidden"} />',
		'<div class={["flex", { hidden: !active }]} />',
		'<div class="flex {classes}" />',
		"<div class={`flex ${classes}`} />",
		{
			code: '<div class="flex block" />',
			options: [{ maxLength: 10 }],
		},
	].map((entry) => ({
		...(typeof entry === "string" ? { code: entry } : entry),
		filename: "sample.svelte",
	})),
	invalid: [
		`<div class="${overLimit}" />`,
		`<Button class='${overLimit}' />`,
		`<div class=${overLimit} />`,
		`<div class={"${overLimit}"} />`,
		`<div class={\`${overLimit}\`} />`,
		`<div class="\n  ${overLimit}\n  " />`,
		`<div class={\`\n  ${overLimit}\n  \`} />`,
		`<div class="${overLimit} {classes}" />`,
		`<div class={\`${overLimit} \${classes}\`} />`,
	]
		.map((code) => ({
			code,
			filename: "sample.svelte",
			errors: [
				{ messageId: "useCn", data: { length: 121, maxLength: 120 } },
			],
			output: null,
		}))
		.concat({
			code: '<div class="flex block" />',
			filename: "sample.svelte",
			options: [{ maxLength: 9 }],
			errors: [
				{ messageId: "useCn", data: { length: 10, maxLength: 9 } },
			],
			output: null,
		}),
});
