// 表現の分類、保護領域、保存形式と CLI の終了コードを検証する。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { findSlopIssues } from "../scripts/textlint-slop.mjs";
import { findEnglishTermIssues } from "../scripts/textlint-terms.mjs";
import {
	extractDocumentAuditItems,
	maskIgnoredDocument,
	writeTextlintIssues,
} from "../scripts/textlint-audit.mjs";
import { extractSourceComments } from "../scripts/extractors/index.mjs";

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

test("high-confidence expressions are errors and contextual words remain review candidates", () => {
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
});

test("protected Markdown and ignored ranges do not produce issues or shift lines", () => {
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
	assert.deepEqual(inspect("参照 [リンク][正本]\n\n[正本]: ./example.md"), []);
	assert.equal(inspect("[正本][参照]\n\n[参照]: ./example.md")[0].term, "正本");
	for (const marker of ["`", "~"]) {
		const fenced = [`${marker.repeat(4)}text`, marker.repeat(3), "設定の正本を更新する", marker.repeat(4), "設計の土台にする。"].join("\n");
		assert.deepEqual(inspect(fenced).map(({ term, line }) => [term, line]), [["土台", 5]]);
	}
	assert.throws(
		() => inspect("<!-- texlint-ignore-start -->\n正本"),
		/unclosed/,
	);
});

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

test("new issue types retain the version 2 schema and twenty-example limit alongside English types", async (t) => {
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
});

test("all CLI modes save review candidates without failing and fail for deterministic patterns", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-slop-cli-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	// 外部辞書の取得を避け、検出と保存の経路だけを検証する。
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
	await fs.writeFile(path.join(root, "sample.md"), "設計の土台にする。\n");
	const cli = fileURLToPath(
		new URL("../scripts/textlint.mjs", import.meta.url),
	);
	for (const mode of ["all", "changed", "review-all", "review-changed"]) {
		for (const [text, expected, type] of [
			["設計の土台にする。\n", 0, "ai-slop"],
			["設定の正本を更新する。\n", 1, "ai-slop-pattern"],
		]) {
			await fs.writeFile(path.join(root, "sample.md"), text);
			const result = spawnSync(
				process.execPath,
				[cli, "--root", root, `--${mode}`, "sample.md"],
				{ encoding: "utf8", timeout: 60000 },
			);
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
