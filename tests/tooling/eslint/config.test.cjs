// Flat Config の上書きや検証経路の変更で、承認された導入範囲が失われる回帰を防ぐ。
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ESLint } = require("eslint");
const { repoRoot } = require("../../../config/workspace-paths.cjs");
const fixtures = require("./fixtures.cjs");
const packageJson = require("../../../package.json");

const rules = [
	"nerita/no-complex-boolean-expression",
	"nerita/no-nested-ternary-expression",
	"nerita/no-complex-inline-callback",
	"nerita/no-await-in-condition",
	"nerita/no-multiline-if-condition",
	"nerita/require-member-function-comment",
];
const eslint = new ESLint({ cwd: repoRoot });
const examples = [
	{
		file: "packages/shared/src/permission.ts",
		code: fixtures.permission,
		expected: [rules[0], rules[4], rules[0]],
	},
	{
		file: "packages/shared/src/subAgents.ts",
		code: fixtures.subAgent,
		expected: [rules[4], rules[0]],
	},
	{
		file: "apps/nerita-dlc/src/state.ts",
		code: fixtures.recoverIntent,
		expected: [rules[4], rules[1]],
	},
	{
		file: "apps/vscode-nerita/src/extension/dlc/DlcHost.ts",
		code: `async function open() {\n${fixtures.runtime}\n}`,
		expected: [rules[2], rules[4], rules[3]],
	},
];

for (const example of examples) {
	test(`${example.file} の実効設定で代表例を一度ずつ検出する`, async () => {
		const config = await eslint.calculateConfigForFile(example.file);
		for (const rule of rules) {
			assert.deepEqual(config.rules[rule], [2], rule);
		}
		const [result] = await eslint.lintText(example.code, {
			filePath: example.file,
		});
		assert.equal(
			result.messages.some((message) => message.fatal),
			false,
		);
		const findings = result.messages
			.filter((message) => message.ruleId?.startsWith("nerita/"))
			.map((message) => message.ruleId);
		assert.deepEqual(findings, example.expected);
		assert.equal(
			result.messages.some(
				(message) => message.ruleId === "no-nested-ternary",
			),
			false,
		);
	});
}

test("各製品領域の実効設定で全ての独自ルールを有効にする", async () => {
	for (const file of [
		"packages/shared/src/validation.ts",
		"apps/nerita-ui/src/chat/ChatConversation.svelte",
		"apps/nerita-dlc/src/controller.ts",
		"apps/vscode-nerita/src/extension/backends/pi/PiRuntime.ts",
	]) {
		const config = await eslint.calculateConfigForFile(file);
		assert.deepEqual(config.rules["no-nested-ternary"], [0]);
		for (const rule of rules) {
			assert.deepEqual(config.rules[rule], [2], file);
		}
	}
});

test("ツール・検証コードでは既存の三項演算子ルールを維持する", async () => {
	const config = await eslint.calculateConfigForFile(
		"config/test-products.cjs",
	);
	assert.deepEqual(config.rules["no-nested-ternary"], [2]);
	for (const rule of rules) {
		assert.equal(config.rules[rule], undefined);
	}
});

test("enum・default export・async forEach の既存の禁止を維持する", async () => {
	const config = await eslint.calculateConfigForFile(
		"packages/shared/src/permission.ts",
	);
	assert.deepEqual(config.rules["no-restricted-syntax"], [
		2,
		{
			selector: "TSEnumDeclaration",
			message: "Use union types or const objects instead of enum.",
		},
		{
			selector: "ExportDefaultDeclaration",
			message: "Use named exports instead of default exports.",
		},
		{
			selector:
				'CallExpression[callee.property.name="forEach"] > ArrowFunctionExpression[async=true]',
			message:
				"Use for...of or Promise.all instead of async forEach callbacks.",
		},
	]);
});

test("標準ルールから置き換えた直接の三項演算子ネストを独自ルールで一度報告する", async () => {
	const [result] = await eslint.lintText("const label = a ? b ? c : d : e;", {
		filePath: "packages/shared/src/permission.ts",
	});
	const nested = result.messages.filter((message) =>
		["nerita/no-nested-ternary-expression", "no-nested-ternary"].includes(
			message.ruleId,
		),
	);
	assert.equal(nested.length, 1);
	assert.equal(nested[0].ruleId, rules[1]);
});

test("ルールの回帰テストを pnpm check から実行できる", () => {
	assert.match(
		packageJson.scripts.check,
		/(?:^|&&\s*)pnpm test:eslint(?:\s*&&|$)/,
	);
	assert.equal(
		packageJson.scripts["test:eslint"],
		"node --test tests/tooling/eslint/*.test.cjs",
	);
	assert.equal(
		packageJson.scripts["lint:readability"],
		"node config/eslint/audit.cjs",
	);
});

test("DlcHost に適用する実効設定で説明のない private async メソッドを拒否する", async () => {
	const [result] = await eslint.lintText(
		"export class DlcHost { private async attempt() {} }",
		{
			filePath: "apps/vscode-nerita/src/extension/dlc/DlcHost.ts",
		},
	);
	const findings = result.messages.filter((message) =>
		message.ruleId?.startsWith("nerita/"),
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].ruleId, "nerita/require-member-function-comment");
});
