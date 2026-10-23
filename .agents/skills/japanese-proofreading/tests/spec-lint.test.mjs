// 仕様書の構造検出、技術記述の保護、除外設定と通常モードの分離を検証する。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createLinter, loadTextlintrc } from "textlint";
import { createSpecLinter } from "../scripts/spec-rules.mjs";
import { maskIgnoredDocument } from "../scripts/textlint-audit.mjs";

const skill = fileURLToPath(new URL("../", import.meta.url));
const linter = await createSpecLinter();

/** 無効化範囲も含め、CLI と同じ入力を検査器へ渡す。 */
async function inspect(source, custom = linter) {
	return (
		await custom.lintText(maskIgnoredDocument(source, "spec.md"), "spec.md")
	).messages;
}

test("閾値を超える一文・段落・箇条書きを警告として区別する", async () => {
	assert.deepEqual(await inspect(`${"あ".repeat(99)}。`), []);
	const sentence = await inspect(`${"あ".repeat(100)}。`);
	assert.deepEqual(
		sentence.map(({ ruleId, severity, line }) => [ruleId, severity, line]),
		[["spec/long-sentence", 1, 1]],
	);
	assert.deepEqual(await inspect("短い文。".repeat(50)), []);
	assert.deepEqual(
		(await inspect("短い文。".repeat(51))).map((m) => m.ruleId),
		["spec/long-paragraph"],
	);
	assert.deepEqual(await inspect(`- ${"短い文。".repeat(40)}`), []);
	assert.deepEqual(
		(await inspect(`- ${"短い文。".repeat(41)}`)).map((m) => m.ruleId),
		["spec/long-list-item"],
	);
});

test("閾値の上書きは仕様書だけに適用し、不正値を拒否する", async () => {
	const custom = await createSpecLinter({
		sentenceMax: 20,
		paragraphMax: 30,
		listItemMax: 25,
		tableMin: 4,
	});
	assert.deepEqual(
		(await inspect("あ".repeat(21), custom)).map((m) => m.ruleId),
		["spec/long-sentence"],
	);
	assert.deepEqual(
		(await inspect("短い文。".repeat(8), custom)).map((m) => m.ruleId),
		["spec/long-paragraph"],
	);
	assert.deepEqual(
		(await inspect(`- ${"短い文。".repeat(7)}`, custom)).map(
			(m) => m.ruleId,
		),
		["spec/long-list-item"],
	);
	assert.deepEqual(await inspect("あ".repeat(21)), []);
	for (const invalid of [
		{ sentenceMax: 0 },
		{ paragraphMax: 1.5 },
		{ listItemMax: NaN },
		{ tableMin: 1 },
		{ other: 100 },
	]) {
		await assert.rejects(createSpecLinter(invalid));
	}
});

test("コード・Schema・URL・識別子を保護し、リンクの表示名は検査する", async () => {
	const token = "longIdentifier".repeat(40);
	const source = [
		"# 技術記述",
		"",
		"```json",
		JSON.stringify({ description: "条件の場合は処理する。".repeat(30) }),
		"```",
		"",
		`命令は \`${token}\` を使う。`,
		`参照は https://example.com/${"a".repeat(400)} を使う。`,
		`[参照](https://example.com/${"a".repeat(400)}) を読む。`,
		`識別子 ${token} を使う。`,
		`<!-- ${"あ".repeat(400)} -->`,
	].join("\n");
	assert.deepEqual(await inspect(source), []);
	const labeled = await inspect(`[${"あ".repeat(101)}](./schema.json)`);
	assert(labeled.some((m) => m.ruleId === "spec/long-sentence"));
	assert(
		(await inspect(`**${"あ".repeat(101)}**`)).some(
			(m) => m.ruleId === "spec/long-sentence",
		),
	);
});

test("子リストの文字数を親に加算せず、長い子項目の元の行を示す", async () => {
	const manyChildren = `- 親\n${Array.from({ length: 60 }, () => "  - 短い文。").join("\n")}`;
	assert.deepEqual(await inspect(manyChildren), []);
	const messages = await inspect(`- 親\n  - ${"短い文。".repeat(41)}`);
	assert.deepEqual(
		messages.map(({ ruleId, line }) => [ruleId, line]),
		[["spec/long-list-item", 2]],
	);
});

test("同じ節で条件と結果が3件続く場合だけ表の候補を出す", async () => {
	const cases = [
		"成功した場合は、保存する。",
		"失敗した場合は、保持する。",
		"未確認の場合は、保留する。",
	];
	for (const source of [
		cases.join(""),
		cases.join("\n\n"),
		cases.map((s) => `- ${s}`).join("\n"),
	]) {
		const messages = await inspect(source);
		assert.equal(
			messages.filter((m) => m.ruleId === "spec/table-candidate").length,
			1,
		);
	}
	assert.deepEqual(await inspect(cases.slice(0, 2).join("")), []);
	assert.deepEqual(await inspect(cases.join("\n\n## 別の節\n\n")), []);
	assert.deepEqual(
		await inspect(cases.map((s) => `- \`${s}\``).join("\n")),
		[],
	);
	const custom = await createSpecLinter({ tableMin: 4 });
	assert.deepEqual(await inspect(cases.join(""), custom), []);
});

test("既存の範囲無効化・ルール別無効化を再利用し、改行位置を保つ", async () => {
	const long = `${"あ".repeat(101)}。`;
	const source = [
		"<!-- texlint-ignore-start -->",
		long,
		"<!-- texlint-ignore-end -->",
		"",
		long,
	].join("\r\n");
	assert.deepEqual(
		(await inspect(source)).map(({ ruleId, line }) => [ruleId, line]),
		[["spec/long-sentence", 5]],
	);
	assert.deepEqual(
		await inspect(
			`<!-- textlint-disable spec/long-sentence -->\n${long}\n<!-- textlint-enable spec/long-sentence -->`,
		),
		[],
	);
	assert.deepEqual(
		await inspect(
			`<!-- textlint-disable -->\n${long}\n<!-- textlint-enable -->`,
		),
		[],
	);
});

test("長い先行行やコードの後でも警告位置を元の文章に対応させる", async () => {
	const source = `# ${"あ".repeat(300)}\r\n\r\n- \`${"longIdentifier".repeat(
		40,
	)}\`\r\n\r\n- ${"い".repeat(101)}。`;
	const messages = await inspect(source);
	const warning = messages.find((m) => m.ruleId === "spec/long-sentence");
	assert.equal(warning.line, 5);
	assert.equal(warning.column, 3);
	assert.equal(
		source.slice(warning.range[0], warning.range[1]),
		`${"い".repeat(101)}。`,
	);
});

/** CLI の対象選択・終了コード・ファイル保持を、独立した作業領域で検証する。 */
async function workspace(t, files) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-spec-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	for (const [file, text] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(root, file)), {
			recursive: true,
		});
		await fs.writeFile(path.join(root, file), text);
	}
	return root;
}

/** シェルを介さず、終了コードと保存した診断を確認するために起動する。 */
function cli(root, args) {
	return spawnSync(
		process.execPath,
		[path.join(skill, "scripts/spec-lint.mjs"), "--root", root, ...args],
		{ encoding: "utf8", timeout: 30000 },
	);
}

test("CLI は明示対象と階層別の除外を使い、警告では失敗せず原文を保持する", async (t) => {
	const long = `${"あ".repeat(101)}。`;
	const root = await workspace(t, {
		".textlintignore": "*.md\nblocked/\n",
		"docs/.textlintignore": "!keep.md\n!nested/keep.md\n",
		"docs/keep.md": long,
		"docs/skip.md": long,
		"docs/nested/.textlintignore": "keep.md\n",
		"docs/nested/keep.md": long,
		"blocked/keep.md": long,
		"node_modules/sample.md": long,
	});
	const result = cli(root, ["docs", "blocked", "node_modules"]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const report = JSON.parse(
		await fs.readFile(
			path.join(root, ".textlint-cache/spec-lint.json"),
			"utf8",
		),
	);
	assert.deepEqual(report.files, ["docs/keep.md"]);
	assert.equal(report.warningCount, 1);
	assert.equal(report.results[0].messages[0].severity, 1);
	assert.equal(
		await fs.readFile(path.join(root, "docs/keep.md"), "utf8"),
		long,
	);
	assert.equal(cli(root, []).status, 2);
	assert.equal(cli(root, ["docs", "--sentence-max", "invalid"]).status, 2);
	assert.equal(cli(root, ["missing.md"]).status, 2);
	assert.equal(cli(root, ["../outside.md"]).status, 2);
});

test("ディレクトリのリンクから検査範囲を広げない", async (t) => {
	const root = await workspace(t, { "real/spec.md": "あ".repeat(101) });
	await fs.symlink(
		path.join(root, "real"),
		path.join(root, "link"),
		"junction",
	);
	assert.equal(cli(root, ["link"]).status, 2);
	const throughParent = cli(root, ["link/spec.md"]);
	assert.equal(
		throughParent.status,
		0,
		throughParent.stdout + throughParent.stderr,
	);
	const report = JSON.parse(
		await fs.readFile(
			path.join(root, ".textlint-cache/spec-lint.json"),
			"utf8",
		),
	);
	assert.deepEqual(report.files, []);
});

test("通常の textlint には仕様書専用ルールを追加しない", async () => {
	const descriptor = await loadTextlintrc({
		configFilePath: path.join(skill, "config/.textlintrc.json"),
		node_modulesDir: path.join(skill, "node_modules"),
	});
	const normal = createLinter({ descriptor });
	const result = await normal.lintText(`${"あ".repeat(101)}。`, "spec.md");
	assert(result.messages.some((m) => m.ruleId.endsWith("/sentence-length")));
	assert(result.messages.every((m) => !m.ruleId.startsWith("spec/")));
});

