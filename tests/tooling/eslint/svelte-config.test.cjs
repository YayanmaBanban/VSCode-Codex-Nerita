// Svelte を解析しても、製品ソースの可読性ルールと通信境界を維持する。
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ESLint } = require("eslint");
const { repoRoot } = require("../../../config/workspace-paths.cjs");

const eslint = new ESLint({ cwd: repoRoot });
const filePath = "apps/nerita-ui/src/chat/ChatWorkspace.svelte";
const prefix =
	"let { a, b, c, d }: { a: boolean; b: boolean; c: boolean; d: boolean } = $props();";

test("製品 Svelte の長い class を cn() へ分割するようエラーにする", async () => {
	const code = `<!-- 長い class の直接指定を検証する。 -->\n<div class="${"a".repeat(121)}" />`;
	const [result] = await eslint.lintText(code, { filePath });
	assert.equal(
		result.messages.some((message) => message.fatal),
		false,
	);
	const findings = result.messages.filter(
		(message) => message.ruleId === "nerita/require-cn-for-long-class",
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].severity, 2);
});

test("長い class のルールをストーリーや Host へ適用しない", async () => {
	for (const file of [
		"apps/nerita-ui/stories/chat/StoryChat.svelte",
		"apps/vscode-nerita/src/extension/extension.ts",
	]) {
		const config = await eslint.calculateConfigForFile(file);
		assert.equal(
			config.rules["nerita/require-cn-for-long-class"],
			undefined,
		);
	}
});

const examples = [
	{
		rule: "no-complex-boolean-expression",
		code: "function choose() { return a && (b || Boolean(c)); }",
	},
	{
		rule: "no-nested-ternary-expression",
		code: "const label = a ? b ? 1 : 2 : 3;",
	},
	{
		rule: "no-complex-inline-callback",
		code: "const values = [1].map(item => { let value = item; value += 1; value += 1; value += 1; value += 1; value += 1; value += 1; value += 1; return value; });",
	},
	{
		rule: "no-await-in-condition",
		code: "async function choose() { if (await Promise.resolve(a)) { return b; } }",
	},
	{
		rule: "no-multiline-if-condition",
		code: "function choose() { if (\na\n) { return b; } }",
	},
	{
		rule: "require-member-function-comment",
		code: "class Model { get value() { return a; } }",
	},
	{
		rule: "require-effect-reason",
		code: "$effect(() => { document.title = String(a); });",
	},
];

for (const example of examples) {
	test(`Svelte script で ${example.rule} の違反を検出する`, async () => {
		const description =
			example.rule === "require-effect-reason"
				? ""
				: "/** 本来の可読性ルールを検証する処理。 */\n";
		const [result] = await eslint.lintText(
			`<!-- 可読性の違反を含む検証用コンポーネント。 -->\n<script lang="ts">${prefix}\n${description}${example.code}</script>`,
			{ filePath },
		);
		assert.equal(
			result.messages.some((message) => message.fatal),
			false,
		);
		const findings = result.messages.filter((message) =>
			message.ruleId?.startsWith("nerita/"),
		);
		assert.deepEqual(
			findings.map((message) => message.ruleId),
			[`nerita/${example.rule}`],
		);
	});
}

test("Svelte の正当な runes・説明付き操作・単純な条件を受理する", async () => {
	const code = `<!-- 説明付きの操作と単純な条件を検証する。 -->
<script lang="ts">${prefix}
let count = $state(0);
/** 入力に応じて表示値を選ぶ。 */
function choose() { const allowed = a && b; return allowed ? c : d; }
/** 説明付きのメンバ操作を検証する状態モデル。 */
class Model {
 /** 確定値を読み出す。 */
 get value() { return count; }
 /** 操作の完了時に更新する。 */
 commit() { count += 1; }
}
</script><button onclick={() => { count += 1; }}>{count}</button>`;
	const [result] = await eslint.lintText(code, { filePath });
	assert.equal(
		result.messages.some((message) => message.fatal),
		false,
	);
	assert.deepEqual(
		result.messages.filter((message) =>
			message.ruleId?.startsWith("nerita/"),
		),
		[],
	);
});

test("Svelte 製品ソースでも Host・検証コードの依存と直接の API 取得を禁止する", async () => {
	const code =
		'<script lang="ts">import vscode from "vscode"; import example from "../../../../tests/example"; acquireVsCodeApi();</script>';
	const [result] = await eslint.lintText(code, { filePath });
	assert.equal(
		result.messages.some((message) => message.fatal),
		false,
	);
	assert.equal(
		result.messages.filter(
			(message) => message.ruleId === "no-restricted-imports",
		).length,
		2,
	);
	assert.equal(
		result.messages.filter(
			(message) => message.ruleId === "no-restricted-globals",
		).length,
		1,
	);
});

for (const file of [
	"apps/nerita-ui/src/chat/ChatWorkspace.svelte",
	"apps/nerita-ui/src/chat/useChat.svelte.ts",
	"apps/nerita-ui/src/chat/example.svelte.js",
	"apps/nerita-ui/stories/chat/StoryChat.svelte",
]) {
	test(`${file} で effect の理由コメントを要求する`, async () => {
		const config = await eslint.calculateConfigForFile(file);
		assert.deepEqual(config.rules["nerita/require-effect-reason"], [2]);
		const code =
			"/** 外部 DOM の監視を登録する。 */\nfunction observe() {\n$effect(() => { document.title = 'chat'; });\n}";
		const wrap = (body) =>
			file.endsWith(".svelte")
				? `<!-- 外部 DOM の監視を検証する。 -->\n<script lang="ts">${body}</script>`
				: `// 外部 DOM の監視を検証する。\n${body}`;
		const [missing] = await eslint.lintText(wrap(code), { filePath: file });
		assert.equal(
			missing.messages.some((message) => message.fatal),
			false,
		);
		assert.equal(
			missing.messages.filter(
				(message) => message.ruleId === "nerita/require-effect-reason",
			).length,
			1,
		);

		const documented = code.replace(
			"$effect",
			"// 外部 DOM のタイトルを状態の変化に合わせて更新する。\n$effect",
		);
		const [present] = await eslint.lintText(wrap(documented), {
			filePath: file,
		});
		assert.equal(
			present.messages.some((message) => message.fatal),
			false,
		);
		assert.deepEqual(
			present.messages.filter(
				(message) => message.ruleId === "nerita/require-effect-reason",
			),
			[],
		);
	});
}

test("Svelte 以外の製品領域に effect のコメント規約を広げない", async () => {
	const config = await eslint.calculateConfigForFile(
		"packages/shared/src/validation.ts",
	);
	assert.equal(config.rules["nerita/require-effect-reason"], undefined);
});
