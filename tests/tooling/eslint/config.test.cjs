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
	"nerita/require-file-comment",
	"nerita/require-declaration-comment",
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
		const [result] = await eslint.lintText(
			`// 可読性の違反を含む導入前の実例。\n${example.code}`,
			{
				filePath: example.file,
			},
		);
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

test("製品の各領域でファイル先頭の説明を要求し、追加後は受理する", async () => {
	for (const file of [
		"packages/shared/src/validation.ts",
		"apps/nerita-ui/src/chat/composer/ComposerInput.svelte",
		"apps/nerita-dlc/src/controller.ts",
		"apps/vscode-nerita/src/extension/backends/pi/PiRuntime.ts",
	]) {
		const component = file.endsWith(".svelte");
		const code = component ? "<div />" : "export const value = 1;";
		const header = component
			? "<!-- 入力値を表示する。 -->\n"
			: "// 入力値を公開する。\n";
		const [missing] = await eslint.lintText(code, { filePath: file });
		assert.equal(
			missing.messages.some((message) => message.fatal),
			false,
		);
		const findings = missing.messages.filter(
			(message) => message.ruleId === "nerita/require-file-comment",
		);
		assert.equal(findings.length, 1, file);
		assert.equal(findings[0].severity, 2);
		assert.equal(findings[0].line, 1);
		assert.equal(findings[0].fix, undefined);

		const [documented] = await eslint.lintText(header + code, {
			filePath: file,
		});
		assert.equal(
			documented.messages.some((message) => message.fatal),
			false,
		);
		assert.deepEqual(
			documented.messages.filter(
				(message) => message.ruleId === "nerita/require-file-comment",
			),
			[],
			file,
		);
	}
});

test("ファイルコメントの必須範囲は製品ソースとする", async () => {
	for (const file of [
		"config/test-products.cjs",
		"tests/product/chat.test.ts",
		"apps/nerita-ui/stories/chat/StoryChat.svelte",
		"apps/nerita-ui/stories/chat/Chat.stories.ts",
	]) {
		const config = await eslint.calculateConfigForFile(file);
		assert.equal(
			config.rules["nerita/require-file-comment"],
			undefined,
			file,
		);
	}
});

test("製品の各領域で非公開と公開の宣言に異なる説明を要求する", async () => {
	for (const file of [
		"packages/shared/src/validation.ts",
		"apps/nerita-ui/src/chat/composer/ComposerInput.svelte",
		"apps/nerita-dlc/src/routing.ts",
		"apps/vscode-nerita/src/extension/backends/pi/PiRuntime.ts",
	]) {
		const component = file.endsWith(".svelte");
		const body =
			"type Local = string;\nexport type Public = Local;\nfunction build() {}";
		const wrap = (text) =>
			component
				? `<!-- 宣言の検証用コンポーネント。 -->\n<script module lang="ts">\n${text}\n</script>`
				: `// 宣言の検証用モジュール。\n\n${text}`;
		const [missing] = await eslint.lintText(wrap(body), { filePath: file });
		assert.equal(
			missing.messages.some((message) => message.fatal),
			false,
			file,
		);
		assert.deepEqual(
			missing.messages
				.filter(
					(message) =>
						message.ruleId === "nerita/require-declaration-comment",
				)
				.map((message) => message.messageId),
			["internal", "public", "internal"],
			file,
		);

		const described = body
			.replace("type Local", "/** 内部の入力形式。 */\ntype Local")
			.replace(
				"export type Public",
				"/** 渡す前に入力を検証すること。 */\nexport type Public",
			)
			.replace(
				"function build",
				"/** 保存用の値を組み立てる。 */\nfunction build",
			);
		const [documented] = await eslint.lintText(wrap(described), {
			filePath: file,
		});
		assert.equal(
			documented.messages.some((message) => message.fatal),
			false,
			file,
		);
		assert.deepEqual(
			documented.messages.filter(
				(message) =>
					message.ruleId === "nerita/require-declaration-comment",
			),
			[],
			file,
		);
	}
});

test("共通設定で import・require と処理の間に空行を要求する", async () => {
	for (const [file, body] of [
		[
			"apps/nerita-dlc/src/routing.ts",
			'import { value } from "./example";\nconst next = value;',
		],
		[
			"config/eslint/index.cjs",
			'const value = require("./example.cjs");\nconst next = value;',
		],
		[
			"apps/nerita-ui/src/chat/composer/ComposerInput.svelte",
			'<script lang="ts">\nimport { value } from "./example";\nconst next = value;\n</script>',
		],
	]) {
		const config = await eslint.calculateConfigForFile(file);
		assert.deepEqual(config.rules["import/newline-after-import"], [
			2,
			{ count: 1 },
		]);
		const [result] = await eslint.lintText(body, { filePath: file });
		assert.equal(
			result.messages.some((message) => message.fatal),
			false,
			file,
		);
		const findings = result.messages.filter(
			(message) => message.ruleId === "import/newline-after-import",
		);
		assert.equal(findings.length, 1, file);
		assert.ok(findings[0].fix);

		const [documented] = await eslint.lintText(
			body.replace(";\nconst next", ";\n\nconst next"),
			{ filePath: file },
		);
		assert.deepEqual(
			documented.messages.filter(
				(message) => message.ruleId === "import/newline-after-import",
			),
			[],
			file,
		);
	}
});

test("enum・default export・async `forEach` の既存の禁止を維持する", async () => {
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

test("`DlcHost` に適用する実効設定で説明のない private async メソッドを拒否する", async () => {
	const [result] = await eslint.lintText(
		[
			"// DLC の実行を管理する。",
			"export class DlcHost { private async attempt() {} }",
		].join("\n"),
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
