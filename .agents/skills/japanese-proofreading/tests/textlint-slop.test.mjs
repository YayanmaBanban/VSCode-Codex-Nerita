// 表現の分類、保護領域、保存形式と CLI の終了コードを検証する。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { findSlopIssues } from "../scripts/textlint-slop.mjs";
import { loadSourceTextPolicy } from "../scripts/textlint-policy.mjs";
import { findEnglishTermIssues } from "../scripts/textlint-terms.mjs";
import {
	extractDocumentAuditItems,
	maskIgnoredDocument,
	writeTextlintIssues,
} from "../scripts/textlint-audit.mjs";
import {
	extractSourceComments,
	extractSourceTexts,
} from "../scripts/extractors/index.mjs";

const config = JSON.parse(
	await fs.readFile(
		new URL("../config/textlint-slop.json", import.meta.url),
		"utf8",
	),
);

/** 文書の抽出と ignore を含む既存経路で検査する。 */
function inspect(text) {
	return findSlopIssues(
		extractDocumentAuditItems(
			maskIgnoredDocument(text, "sample.md"),
			"sample.md",
		),
		config,
	);
}

const checkExpressionConfidence = () => {
	const errors = [
		"設定の正本を更新する",
		"安全側に倒す",
		"調査に時間を溶かした",
		"データが静かに壊れる",
		"実 VS Code で確認する",
		"実 Webview で確認する",
		"実 `someIdentifier` で確認する",
		"意思決定OSを作る",
		"1つずつ潰す",
		"黙って無視する",
		"黙って捨てる",
		"黙って破棄する",
		"地味に効く",
		"実装まで踏み込む",
	];
	for (const text of errors) {
		const issues = inspect(text);
		assert.equal(issues.length, 1, text);
		assert.equal(issues[0].type, "ai-slop-pattern", text);
		assert(issues[0].suggestion.length > 0);
		assert.equal(issues[0].text, text);
	}
	for (const text of [
		"設計の土台にする",
		"操作の手触りを改善する",
		"チームの腹落ちを優先する",
		"肌感覚を記録する",
		"接続した瞬間に記録する",
	]) {
		assert.deepEqual(
			inspect(text).map((issue) => issue.type),
			["ai-slop"],
			text,
		);
	}
	assert.deepEqual(
		inspect(
			"画像の解像度を変更する。実測値と計算値を照合する。装置を停止する。実装を更新する。実行結果を確認する。実機で確認する。事実 API は存在する。部屋まで踏み込む。",
		),
		[],
	);
};
test(
	"high-confidence expressions are errors and contextual words remain review candidates",
	checkExpressionConfidence,
);

const checkProtectedMarkdown = () => {
	const source = [
		"# 検査",
		"",
		"```text",
		"正本",
		"```",
		"~~~text",
		"土台",
		"~~~",
		"`正本` と ``土台 ` 正本`` を示す。",
		"https://example.com/正本 [参照](./正本.md)",
		"<!--",
		"正本",
		"",
		"土台",
		"-->",
		"<!-- texlint-ignore-start -->",
		"静かに壊れる",
		"<!-- texlint-ignore-end -->",
		"",
		"設定の正本を更新する。",
	].join("\r\n");
	const issues = inspect(source);
	assert.deepEqual(
		issues.map(({ type, line, term }) => ({ type, line, term })),
		[{ type: "ai-slop-pattern", line: 20, term: "正本" }],
	);
	assert.deepEqual(inspect("`実 VS Code` と `実 foo` を示す。"), []);
	assert.equal(inspect("[正本](./example.md)")[0].term, "正本");
	assert.deepEqual(
		inspect("参照 [リンク][正本]\n\n[正本]: ./example.md"),
		[],
	);
	assert.equal(
		inspect("[正本][参照]\n\n[参照]: ./example.md")[0].term,
		"正本",
	);
	for (const marker of ["`", "~"]) {
		const fenced = [
			`${marker.repeat(4)}text`,
			marker.repeat(3),
			"設定の正本を更新する",
			marker.repeat(4),
			"設計の土台にする。",
		].join("\n");
		assert.deepEqual(
			inspect(fenced).map(({ term, line }) => [term, line]),
			[["土台", 5]],
		);
	}
	assert.throws(
		() => inspect("<!-- texlint-ignore-start -->\n正本"),
		/unclosed/,
	);
};
test(
	"protected Markdown and ignored ranges do not produce issues or shift lines",
	checkProtectedMarkdown,
);

test("TypeScript and Rust comments reuse extraction without inspecting string literals", () => {
	for (const file of ["sample.ts", "sample.rs"]) {
		const { items } = extractSourceComments(
			'const text = "正本";\n// 設定の正本を更新する。\n// 設計の土台にする。',
			file,
		);
		assert.deepEqual(
			findSlopIssues(items, config).map(({ type, line }) => [type, line]),
			[
				["ai-slop-pattern", 2],
				["ai-slop", 3],
			],
		);
	}
});

test("multiline comments and inline code retain source line numbers", () => {
	for (const file of ["sample.ts", "sample.rs"]) {
		const { items } = extractSourceComments(
			"/**\n * `正本\n * 土台` を示す。\n * 設定の正本を更新する。\n */",
			file,
		);
		assert.deepEqual(
			findSlopIssues(items, config).map(({ term, line }) => [term, line]),
			[["正本", 4]],
		);
	}
});

const checkSourceStringTerms = () => {
	const source = [
		'console.log("実 Webview: 起動に成功");',
		'throw new Error("実 Webview の起動に失敗しました。");',
		"const text = `設計の土台にする。${count}",
		"実 Webview で確認する。`;",
		'const terms = "fallback と strangelexeme と readValue を確認する。";',
		'const protectedText = "`正本` を参照する https://example.com/正本 [参照](./正本.md)";',
	].join("\r\n");
	const items = extractSourceTexts(source, "sample.ts");
	assert.deepEqual(
		findSlopIssues(items, config).map(({ type, line }) => [type, line]),
		[
			["ai-slop-pattern", 1],
			["ai-slop-pattern", 2],
			["ai-slop", 3],
			["ai-slop-pattern", 4],
		],
	);
	assert.deepEqual(
		findEnglishTermIssues(
			items,
			{
				allowedEnglish: ["Webview"],
				preferredJapanese: { fallback: "代替処理" },
			},
			new Set(),
			new Set(["readValue"]),
		).map(({ type, line }) => [type, line]),
		[
			["preferred-japanese", 5],
			["unknown-english", 5],
			["unquoted-identifier", 5],
		],
	);
};
test(
	"source strings reuse slop and terminology checks while protecting code and URLs",
	checkSourceStringTerms,
);

test("source placeholders protect replacement names without hiding surrounding terms", () => {
	const source = [
		'const message = "上限は {{maxLength}} 文字です。maxLength を確認する。";',
		'const spaced = "件数は {{ maxLength }} と {{\textra_limit\t}} です。";',
		'const preferred = "{{owner}} を使い、owner を確認する。";',
		"const template = `上限は {{maxLength}} です。${count}日本語 strangerword`;",
	].join("\r\n");
	const issues = findEnglishTermIssues(
		extractSourceTexts(source, "sample.cjs"),
		{ preferredJapanese: { owner: "所有者" } },
		new Set(),
		new Set(["maxLength", "extra_limit"]),
	);
	assert.deepEqual(
		issues.map(({ type, term, line }) => [type, term, line]),
		[
			["unquoted-identifier", "maxLength", 1],
			["preferred-japanese", "owner", 3],
			["unknown-english", "strangerword", 4],
		],
	);
	assert.equal(
		issues[0].text,
		"上限は {{maxLength}} 文字です。maxLength を確認する。",
	);
});

test("incomplete placeholders and identifiers in comments or prose remain checked", () => {
	const source = [
		'const single = "上限は {maxLength} です。";',
		'const incomplete = "上限は {{maxLength} です。";',
		'const expression = "上限は {{maxLength + 1}} です。";',
		"// 上限は {{maxLength}} です。",
		"/** 上限は {{maxLength}} です。 */",
		"const value = 0;",
	].join("\n");
	const items = [
		...extractSourceTexts(source, "sample.cjs"),
		...extractSourceComments(source, "sample.cjs").items,
		...extractDocumentAuditItems(
			"上限は {{maxLength}} です。",
			"sample.md",
		),
	];
	assert.deepEqual(
		findEnglishTermIssues(items, {}, new Set(), new Set(["maxLength"]))
			.filter((issue) => issue.type === "unquoted-identifier")
			.map(({ file, term, line }) => [file, term, line]),
		[
			["sample.cjs", "maxLength", 1],
			["sample.cjs", "maxLength", 2],
			["sample.cjs", "maxLength", 3],
			["sample.cjs", "maxLength", 4],
			["sample.cjs", "maxLength", 5],
			["sample.md", "maxLength", 1],
		],
	);
});

test("source escapes do not become English terms or hide the following words", () => {
	const source = [
		String.raw`const omitted = "\n… 出力を省略 …\n";`,
		String.raw`const shell = "\nPowerShell の実行が可能になります。";`,
		String.raw`const sandbox = "\nSandbox の拒否を確認しました。\n";`,
		String.raw`const terms = "日本語\r\nstrangelexeme\tfallback\breadValue\f\v\0";`,
		"const template = `日本語\\nstrangelexeme${count}",
		"日本語\\r\\nstrangelexeme`;",
		String.raw`const encoded = "日本語\x0Astrangelexeme\u000Astrangelexeme\u{A}strangelexeme";`,
	].join("\r\n");
	const items = extractSourceTexts(source, "sample.ts");
	const issues = findEnglishTermIssues(
		items,
		{
			preferredJapanese: {
				sandbox: "サンドボックス",
				fallback: "代替処理",
			},
		},
		new Set(),
		new Set(["readValue"]),
	);

	assert.deepEqual(
		issues.map(({ type, term, line }) => [type, term, line]),
		[
			["preferred-japanese", "Sandbox", 3],
			["unknown-english", "strangelexeme", 4],
			["preferred-japanese", "fallback", 4],
			["unquoted-identifier", "readValue", 4],
			["unknown-english", "strangelexeme", 5],
			["unknown-english", "strangelexeme", 6],
			["unknown-english", "strangelexeme", 7],
			["unknown-english", "strangelexeme", 7],
			["unknown-english", "strangelexeme", 7],
		],
	);
	assert.equal(
		issues[0].text,
		String.raw`\nSandbox の拒否を確認しました。\n`,
	);
	assert.equal(items[0].text, String.raw`\n… 出力を省略 …\n`);
});

test("escaped backslashes and prose keep literal English terms", () => {
	const source = [
		String.raw`const literal = "日本語\\nPowerShell";`,
		String.raw`const newline = "日本語\\\nPowerShell";`,
		String.raw`// 日本語\nPowerShell`,
	].join("\n");
	const items = [
		...extractSourceTexts(source, "sample.ts"),
		...extractSourceComments(source, "sample.ts").items,
		...extractDocumentAuditItems(
			String.raw`日本語\nPowerShell`,
			"sample.md",
		),
	];

	assert.deepEqual(
		findEnglishTermIssues(items, {}).map(({ file, term, line }) => [
			file,
			term,
			line,
		]),
		[
			["sample.ts", "nPowerShell", 1],
			["sample.ts", "nPowerShell", 3],
			["sample.md", "nPowerShell", 1],
		],
	);
});

const checkIssueSchema = async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-slop-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const items = extractDocumentAuditItems(
		"正本 土台\n".repeat(25),
		"sample.md",
	);
	const english = findEnglishTermIssues(
		[
			{
				file: "sample.md",
				startLine: 30,
				text: "fallback と strangelexeme と readValue を確認する。",
			},
		],
		{ preferredJapanese: { fallback: "代替処理" } },
		new Set(),
		new Set(["readValue"]),
	);
	assert.deepEqual(
		english.map((issue) => issue.type),
		["preferred-japanese", "unknown-english", "unquoted-identifier"],
	);
	const output = await writeTextlintIssues({
		root,
		scope: "all",
		issues: [...findSlopIssues(items, config), ...english],
	});
	const saved = JSON.parse(await fs.readFile(output, "utf8"));
	assert.equal(saved.version, 2);
	assert.equal(saved.issueCount, 53);
	assert.equal(saved.termCount, 5);
	for (const issue of saved.issues.filter((issue) =>
		issue.type.startsWith("ai-slop"),
	)) {
		assert.equal(issue.occurrenceCount, 25);
		assert.equal(issue.occurrences.length, 20);
		assert.deepEqual(issue.occurrences[0], {
			file: "sample.md",
			line: 1,
			text: "正本 土台",
		});
	}
};
test(
	"new issue types retain the version 2 schema and twenty-example limit alongside English types",
	checkIssueSchema,
);

/** 外部辞書を取得せずに CLI を検証できるよう、一時ディレクトリと辞書キャッシュを用意する。 */
async function createCliWorkspace(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-slop-cli-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.mkdir(path.join(root, ".textlint-cache"));
	const dictionaryConfig = JSON.parse(
		await fs.readFile(
			new URL("../config/textlint-terms.json", import.meta.url),
			"utf8",
		),
	);
	await fs.writeFile(
		path.join(root, ".textlint-cache", "technical-terms.json"),
		JSON.stringify({
			version: 1,
			revision: dictionaryConfig.technicalDictionary.revision,
			files: dictionaryConfig.technicalDictionary.files,
			terms: [],
		}),
	);
	return root;
}

/** 指定モードを別プロセスで実行し、終了コードと診断出力を返す。 */
function runCli(root, mode, file) {
	const cli = fileURLToPath(
		new URL("../scripts/textlint.mjs", import.meta.url),
	);
	return spawnSync(
		process.execPath,
		[cli, "--root", root, `--${mode}`, ...(file ? [file] : [])],
		{
			encoding: "utf8",
			timeout: 60000,
		},
	);
}

test("all CLI modes save review candidates without failing and fail for deterministic patterns", async (t) => {
	const root = await createCliWorkspace(t);
	for (const mode of ["all", "changed", "review-all", "review-changed"]) {
		for (const [text, expected, type] of [
			["設計の土台にする。\n", 0, "ai-slop"],
			["設定の正本を更新する。\n", 1, "ai-slop-pattern"],
		]) {
			await fs.writeFile(path.join(root, "sample.md"), text);
			const result = runCli(root, mode, "sample.md");
			assert.equal(
				result.status,
				expected,
				result.stdout + result.stderr,
			);
			const scope = mode.includes("changed") ? "changed" : "all";
			const saved = JSON.parse(
				await fs.readFile(
					path.join(root, ".textlint-cache", `issues-${scope}.json`),
					"utf8",
				),
			);
			assert.deepEqual(
				saved.issues.map((issue) => issue.type),
				[type],
			);
			if (mode.startsWith("review")) {
				assert.match(
					await fs.readFile(
						path.join(
							root,
							".textlint-cache",
							`review-${scope}.jsonl`,
						),
						"utf8",
					),
					/sample.md/,
				);
			}
		}
	}
});

async function createNestedIgnoreWorkspace(t) {
	const root = await createCliWorkspace(t);
	const files = {
		".textlintignore": "*.ts\n/blocked/\n",
		"skill/.textlintignore": "/tests/\n!keep.ts\n",
		"skill/nested/.textlintignore": "!deep.ts\n",
		"blocked/.textlintignore": "!error.ts\n",
		"root.ts": 'const text = "設定の正本を更新する。";',
		"skill/hidden.ts": 'const text = "設定の正本を更新する。";',
		"skill/tests/error.ts": 'const text = "設定の正本を更新する。";',
		"blocked/error.ts": 'const text = "設定の正本を更新する。";',
		"sibling/keep.ts": 'const text = "設定の正本を更新する。";',
		"skill/keep.ts": 'const text = "設定を確認します。";',
		"skill/nested/deep.ts": 'const text = "接続を確認します。";',
	};
	for (const [file, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(root, file)), {
			recursive: true,
		});
		await fs.writeFile(path.join(root, file), content);
	}
	for (const args of [
		["init", "--quiet"],
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--quiet",
			"--allow-empty",
			"-m",
			"Initial",
		],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stdout + result.stderr);
	}
	return root;
}

const checkNestedIgnoreModes = async (t) => {
	const root = await createNestedIgnoreWorkspace(t);
	for (const mode of ["all", "changed", "review-all", "review-changed"]) {
		const result = runCli(root, mode);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		if (mode.startsWith("review")) {
			const scope = mode.includes("changed") ? "changed" : "all";
			const output = await fs.readFile(
				path.join(root, ".textlint-cache", `review-${scope}.jsonl`),
				"utf8",
			);
			const records = output
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.deepEqual(
				records
					.slice(1)
					.map(({ file }) => file)
					.sort(),
				["skill/keep.ts", "skill/nested/deep.ts"],
			);
		}
		const excluded = runCli(root, mode, "skill/tests/error.ts");
		assert.equal(excluded.status, 0, excluded.stdout + excluded.stderr);
		assert.match(excluded.stdout, /対象ファイルはありません/);
	}
	await fs.writeFile(
		path.join(root, "skill/keep.ts"),
		'const text = "設定の正本を更新する。";',
	);
	const included = runCli(root, "changed", "skill/keep.ts");
	assert.equal(included.status, 1, included.stdout + included.stderr);
};
test(
	"nested ignores apply to all, changed and explicitly selected CLI targets",
	checkNestedIgnoreModes,
);

const checkCliSourceStrings = async (t) => {
	const root = await createCliWorkspace(t);
	const source = [
		'const command = "git status", event = "webview.ready", file = "./sample.ts";',
		'const key = "処理済み";',
		'const view = <div>接続を再試行します{followUp ? "フォローアップを送信" : "チャットを送信"}</div>;',
		`const longLabel = "${"説明".repeat(60)}";`,
	].join("\n");
	const errors =
		'\nconsole.log("実 Webview: 起動に成功");\nthrow new Error("実 Webview の起動に失敗しました。");';
	for (const mode of ["all", "changed", "review-all", "review-changed"]) {
		await fs.writeFile(path.join(root, "sample.tsx"), source + errors);
		const failed = runCli(root, mode, "sample.tsx");
		assert.equal(failed.status, 1, failed.stdout + failed.stderr);
		assert.equal(
			await fs.readFile(path.join(root, "sample.tsx"), "utf8"),
			source + errors,
		);
		const scope = mode.includes("changed") ? "changed" : "all";
		const issuesPath = path.join(
			root,
			".textlint-cache",
			`issues-${scope}.json`,
		);
		const saved = JSON.parse(await fs.readFile(issuesPath, "utf8"));
		const slop = saved.issues.filter(
			({ type }) => type === "ai-slop-pattern",
		);
		assert.deepEqual(
			slop
				.flatMap(({ occurrences }) => occurrences)
				.map(({ line }) => line),
			[5, 6],
		);

		await fs.writeFile(path.join(root, "sample.tsx"), source);
		const passed = runCli(root, mode, "sample.tsx");
		assert.equal(passed.status, 0, passed.stdout + passed.stderr);
		assert.equal(
			await fs.readFile(path.join(root, "sample.tsx"), "utf8"),
			source,
		);
		await assert.rejects(fs.readFile(issuesPath), { code: "ENOENT" });
		const reviewPath = path.join(
			root,
			".textlint-cache",
			`review-${scope}.jsonl`,
		);
		if (!mode.startsWith("review")) {
			await assert.rejects(fs.readFile(reviewPath), { code: "ENOENT" });
			continue;
		}

		const records = (await fs.readFile(reviewPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(records[0].itemCount, 5);
		assert.deepEqual(
			records
				.slice(1)
				.map(({ kind, text, startLine, endLine }) => [
					kind,
					text,
					startLine,
					endLine,
				]),
			[
				["string", "処理済み", 2, 2],
				["jsx-text", "接続を再試行します", 3, 3],
				["string", "フォローアップを送信", 3, 3],
				["string", "チャットを送信", 3, 3],
				["string", "説明".repeat(60), 4, 4],
			],
		);
	}
};
test(
	"all CLI modes inspect source strings without prose presets or rewriting machine values",
	checkCliSourceStrings,
);

test("source-text policy defaults to static inspection and rejects invalid configuration", async (t) => {
	const root = await createCliWorkspace(t);
	const file = path.join(root, ".textlint-policy.json");
	const defaultPolicy = await loadSourceTextPolicy(root);
	assert.equal(defaultPolicy("stories/sample.ts"), false);

	await fs.writeFile(
		file,
		JSON.stringify({ reviewOnlySourceTexts: ["stories/"] }),
	);
	const configured = await loadSourceTextPolicy(root);
	assert.equal(configured("stories/nested/sample.svelte"), true);
	assert.equal(configured("stories\\nested\\sample.tsx"), true);
	assert.equal(configured("stories-copy/sample.ts"), false);
	assert.equal(configured("src/sample.ts"), false);

	for (const invalid of [
		null,
		[],
		{ reviewOnlySourceText: ["stories/"] },
		{ reviewOnlySourceTexts: null },
		{ reviewOnlySourceTexts: "stories/" },
		{ reviewOnlySourceTexts: [false] },
		{ reviewOnlySourceTexts: [""] },
		{ reviewOnlySourceTexts: ["stories/\nsrc/"] },
	]) {
		await fs.writeFile(file, JSON.stringify(invalid));
		await assert.rejects(loadSourceTextPolicy(root), Error);
	}
	await fs.writeFile(file, "{");
	await assert.rejects(loadSourceTextPolicy(root), SyntaxError);
});

/** 全モードで文言を検査から外し、レビューでは元の位置と値を保持することを確認する。 */
async function checkReviewOnlySourceModes(root, fixture, text) {
	const file = path.join(root, fixture.file);
	await fs.writeFile(file, fixture.source);
	for (const mode of ["all", "changed", "review-all", "review-changed"]) {
		const result = runCli(root, mode, fixture.file);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		const scope = mode.includes("changed") ? "changed" : "all";
		await assert.rejects(
			fs.readFile(
				path.join(root, ".textlint-cache", `issues-${scope}.json`),
			),
			{ code: "ENOENT" },
		);
		if (mode.startsWith("review")) {
			const records = (
				await fs.readFile(
					path.join(root, ".textlint-cache", `review-${scope}.jsonl`),
					"utf8",
				)
			)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
				.slice(1);
			assert(records.some((item) => item.kind === "comment"));
			assert(
				records.some(
					(item) =>
						item.kind === "string" &&
						item.text === text &&
						item.startLine === fixture.stringLine,
				),
			);
			assert(records.some((item) => item.text.includes("の結果")));
			assert(
				records.some(
					(item) =>
						item.kind === "svelte-attribute" ||
						(item.kind === "string" && item.startLine === 3),
				),
			);
		}
		assert.equal(await fs.readFile(file, "utf8"), fixture.source);
	}
}

/** 同じ対象でもコメントの用語と文体の指摘はエラーになることを確認する。 */
async function checkStoryComment(root, fixture) {
	const file = path.join(root, fixture.file);
	await fs.writeFile(
		file,
		fixture.source.replace(
			"検証用の入力を用意する。",
			"workspace の正本を確認する。",
		),
	);
	const commentResult = runCli(root, "review-changed", fixture.file);
	assert.equal(
		commentResult.status,
		1,
		commentResult.stdout + commentResult.stderr,
	);
	const saved = JSON.parse(
		await fs.readFile(
			path.join(root, ".textlint-cache", "issues-changed.json"),
			"utf8",
		),
	);
	assert.deepEqual(saved.issues.map((issue) => issue.type).sort(), [
		"ai-slop-pattern",
		"preferred-japanese",
	]);
	assert(saved.issues.every((issue) => issue.occurrences[0].line === 1));
}

test("review-only source texts retain review data while comments and other sources still fail", async (t) => {
	const root = await createCliWorkspace(t);
	await fs.writeFile(
		path.join(root, ".textlint-policy.json"),
		JSON.stringify({ reviewOnlySourceTexts: ["stories/"] }),
	);
	await fs.mkdir(path.join(root, "stories"));
	await fs.mkdir(path.join(root, "src"));
	const text = "workspace の正本と readValue を確認する。";
	const sources = [
		{
			file: "stories/sample.tsx",
			source: [
				"// 検証用の入力を用意する。",
				`const readValue = "${text}";`,
				`const view = <div title="${text}">{readValue}の結果</div>;`,
			].join("\n"),
			stringLine: 2,
		},
		{
			file: "stories/sample.svelte",
			source: [
				"<!-- 検証用の入力を用意する。 -->",
				'<script lang="ts">',
				`const readValue = "${text}";`,
				"</script>",
				`<div title="${text}">{readValue}の結果</div>`,
			].join("\n"),
			stringLine: 3,
		},
	];
	for (const fixture of sources) {
		await checkReviewOnlySourceModes(root, fixture, text);
		await checkStoryComment(root, fixture);
	}
	await fs.writeFile(path.join(root, "src/sample.tsx"), sources[0].source);
	const outside = runCli(root, "changed", "src/sample.tsx");
	assert.equal(outside.status, 1, outside.stdout + outside.stderr);
	const saved = JSON.parse(
		await fs.readFile(
			path.join(root, ".textlint-cache", "issues-changed.json"),
			"utf8",
		),
	);
	assert(saved.issues.some((issue) => issue.type === "unquoted-identifier"));

	await fs.writeFile(
		path.join(root, "stories/notes.md"),
		"設定の正本を更新する。\n",
	);
	const document = runCli(root, "changed", "stories/notes.md");
	assert.equal(document.status, 1, document.stdout + document.stderr);
});

test("Svelte CLI targets report comments, script strings, attributes and markup at original lines", async (t) => {
	const root = await createCliWorkspace(t);
	const makeSource = (message) =>
		[
			`<!-- ${message} -->`,
			'<script lang="ts">',
			`const labelText: string = "${message}";`,
			"</script>",
			`<div title="${message}">`,
			message,
			"{labelText}",
			`<span>${"説明".repeat(60)}</span></div>`,
		].join("\r\n");
	for (const mode of ["all", "changed", "review-all", "review-changed"]) {
		const file = path.join(root, "sample.svelte");
		const failedSource = makeSource("設定の正本を更新する。");
		await fs.writeFile(file, failedSource);
		const failed = runCli(root, mode, "sample.svelte");
		assert.equal(failed.status, 1, failed.stdout + failed.stderr);
		const scope = mode.includes("changed") ? "changed" : "all";
		const issuesPath = path.join(
			root,
			".textlint-cache",
			`issues-${scope}.json`,
		);
		const saved = JSON.parse(await fs.readFile(issuesPath, "utf8"));
		assert.deepEqual(
			saved.issues
				.filter(({ type }) => type === "ai-slop-pattern")
				.flatMap(({ occurrences }) => occurrences)
				.map(({ line }) => line),
			[1, 3, 5, 6],
		);
		assert.equal(await fs.readFile(file, "utf8"), failedSource);

		const passedSource = makeSource("設定を確認します。");
		await fs.writeFile(file, passedSource);
		const passed = runCli(root, mode, "sample.svelte");
		assert.equal(passed.status, 0, passed.stdout + passed.stderr);
		await assert.rejects(fs.readFile(issuesPath), { code: "ENOENT" });
		if (mode.startsWith("review")) {
			const records = (
				await fs.readFile(
					path.join(root, ".textlint-cache", `review-${scope}.jsonl`),
					"utf8",
				)
			)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.deepEqual(
				records
					.slice(1)
					.map(({ kind, startLine, endLine }) => [
						kind,
						startLine,
						endLine,
					]),
				[
					["comment", 1, 1],
					["string", 3, 3],
					["svelte-attribute", 5, 5],
					["svelte-text", 5, 6],
					["svelte-text", 8, 8],
				],
			);
		}
	}
});
