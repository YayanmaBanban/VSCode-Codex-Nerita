import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import ignore from "ignore";
import { extractSourceComments } from "./textlint-comments.mjs";
import {
	extractDocumentAuditItems,
	writeTextlintAudit,
} from "./textlint-audit.mjs";

import { createLinter, loadLinterFormatter, loadTextlintrc } from "textlint";

const ROOT = process.cwd();

const mode = process.argv[2] ?? "--all";

if (mode !== "--all" && mode !== "--changed") {
	console.error("Usage: node scripts/textlint.mjs --all|--changed");
	process.exit(2);
}

/**
 * textlintで本文全体を検査するファイル。
 */
const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);

/**
 * コメントだけ抽出して検査するソースコード。
 *
 * TypeScriptの構文解析を利用するため、JS / TS系に限定する。
 */
const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
]);

const TARGET_EXTENSIONS = new Set([
	...DOCUMENT_EXTENSIONS,
	...SOURCE_EXTENSIONS,
]);

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * Windowsのパス区切りを統一する。
 * `.textlintignore` 用に "/" へ統一する。
 */
function normalizePath(filePath) {
	return filePath.split(path.sep).join("/");
}

/**
 * `.textlintignore` を読み込む。
 */
async function loadTextlintIgnore() {
	const matcher = ignore();
	const ignorePath = path.join(ROOT, ".textlintignore");

	try {
		const content = await fs.readFile(ignorePath, "utf8");

		matcher.add(content);
	} catch (error) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
	}

	return matcher;
}

/**
 * 対象拡張子か。
 */
function isTargetFile(filePath) {
	return TARGET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * リポジトリ全体を走査する。
 *
 * `.gitignore` には依存しない。
 * lint除外は `.textlintignore` だけで決定する。
 */
async function getAllFiles(ignoreMatcher) {
	const files = [];

	async function walk(directory) {
		const entries = await fs.readdir(directory, {
			withFileTypes: true,
		});

		for (const entry of entries) {
			const absolutePath = path.join(directory, entry.name);

			const relativePath = normalizePath(
				path.relative(ROOT, absolutePath),
			);

			/**
			 * シンボリックリンクは追跡しない。
			 *
			 * リポジトリ外への走査やディレクトリループを防ぐ。
			 */
			if (entry.isSymbolicLink()) {
				continue;
			}

			if (entry.isDirectory()) {
				if (ignoreMatcher.ignores(`${relativePath}/`)) {
					continue;
				}

				await walk(absolutePath);
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			if (ignoreMatcher.ignores(relativePath)) {
				continue;
			}

			if (!isTargetFile(relativePath)) {
				continue;
			}

			files.push(relativePath);
		}
	}

	await walk(ROOT);

	return files;
}

/**
 * `git` コマンドを実行し、NUL区切りのファイル一覧を返す。
 */
function gitFiles(args) {
	const output = execFileSync("git", args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});

	return output.split("\0").filter(Boolean).map(normalizePath);
}

/**
 * Gitで変更されたファイルを取得する。
 *
 * HEADとの差分に未追跡ファイルを加え、
 * ステージ済み・未ステージの変更を含める。
 */
async function getChangedFiles(ignoreMatcher) {
	const changed = gitFiles([
		"diff",
		"--name-only",
		"--diff-filter=ACMR",
		"-z",
		"HEAD",
		"--",
	]);

	const untracked = gitFiles([
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
	]);

	const candidates = [...new Set([...changed, ...untracked])];

	const files = [];

	for (const file of candidates) {
		if (ignoreMatcher.ignores(file)) {
			continue;
		}

		if (!isTargetFile(file)) {
			continue;
		}

		try {
			const stat = await fs.lstat(path.join(ROOT, file));

			if (!stat.isFile() || stat.isSymbolicLink()) {
				continue;
			}
		} catch {
			continue;
		}

		files.push(file);
	}

	return files;
}

/**
 * 検査対象を取得する。
 */
const ignoreMatcher = await loadTextlintIgnore();

const files =
	mode === "--changed"
		? await getChangedFiles(ignoreMatcher)
		: await getAllFiles(ignoreMatcher);

const auditItems = [];

if (files.length === 0) {
	const auditPath = await writeTextlintAudit({
		root: ROOT,
		mode,
		items: auditItems,
	});

	console.log("textlint: 対象ファイルはありません。");
	console.log(
		`textlint audit: ${normalizePath(path.relative(ROOT, auditPath))}`,
	);

	process.exit(0);
}

/**
 * `.textlintrc.json` を読み込む。
 */
const descriptor = await loadTextlintrc();

const linter = createLinter({
	descriptor,
});

const results = [];

for (const file of files) {
	const absolutePath = path.join(ROOT, file);

	const source = await fs.readFile(absolutePath, "utf8");

	const extension = path.extname(file).toLowerCase();

	/**
	 * Markdown / Text
	 *
	 * ファイル内容をそのまま検査する。
	 * textlint結果とは別に、全日本語文章を監査JSONへ保存する。
	 */
	if (DOCUMENT_EXTENSIONS.has(extension)) {
		auditItems.push(...extractDocumentAuditItems(source, file));

		// 日本語を含まない文書には日本語用の校正規則を適用しない。
		if (!JAPANESE_PATTERN.test(source)) {
			continue;
		}

		const result = await linter.lintText(source, file);

		results.push(result);
		continue;
	}

	/**
	 * JS / TS
	 *
	 * コメントだけを抽出する。
	 * 全日本語コメントはtextlintの診断結果に関係なく監査JSONへ保存する。
	 */
	if (SOURCE_EXTENSIONS.has(extension)) {
		const extracted = extractSourceComments(source, file);

		auditItems.push(...extracted.items);

		if (!JAPANESE_PATTERN.test(extracted.lintText)) {
			continue;
		}

		/**
		 * `.txt` として解析し、
		 * インデントなどをMarkdown構文として解釈させない。
		 */
		const result = await linter.lintText(extracted.lintText, `${file}.txt`);

		/**
		 * 表示上は元のソースファイル名へ戻す。
		 */
		results.push({
			...result,
			filePath: file,
		});
	}
}

/**
 * textlintで警告されたかどうかに関係なく、
 * 全日本語コメント・文書をLLMレビュー用JSONへ保存する。
 */
const auditPath = await writeTextlintAudit({
	root: ROOT,
	mode,
	items: auditItems,
});

/**
 * 通常のtextlintと同じ`stylish`形式。
 */
const formatter = await loadLinterFormatter({
	formatterName: "stylish",
});

const formatted = formatter.format(results);

if (formatted.trim()) {
	console.log(formatted);
}

console.log(`textlint audit: ${normalizePath(path.relative(ROOT, auditPath))}`);

const messageCount = results.reduce(
	(count, result) => count + result.messages.length,
	0,
);

if (messageCount > 0) {
	process.exitCode = 1;
}
