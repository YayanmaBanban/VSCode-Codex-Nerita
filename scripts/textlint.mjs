import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import ignore from "ignore";
import { extractSourceComments } from "./textlint-comments.mjs";
import {
	cleanTextlintCache,
	clearTextlintCacheForScope,
	extractDocumentAuditItems,
	writeTextlintIssues,
	writeTextlintReview,
} from "./textlint-audit.mjs";
import {
	filterFilesByTargets,
	resolveTextlintTargets,
	shouldUseChangedFiles,
} from "./textlint-targets.mjs";
import { findEnglishTermIssues } from "./textlint-terms.mjs";

import { createLinter, loadLinterFormatter, loadTextlintrc } from "textlint";

const ROOT = process.cwd();

const MODE_OPTIONS = new Map([
	["--all", { scope: "all", changed: false, review: false }],
	["--changed", { scope: "changed", changed: true, review: false }],
	["--review-all", { scope: "all", changed: false, review: true }],
	["--review-changed", { scope: "changed", changed: true, review: true }],
]);

const rawMode = process.argv[2] ?? "--all";

if (rawMode === "--clean") {
	await cleanTextlintCache(ROOT);
	console.log("textlint cache: cleared");
	process.exit(0);
}

const mode = MODE_OPTIONS.get(rawMode);

if (!mode) {
	console.error(
		"Usage: node scripts/textlint.mjs --all|--changed|--review-all|--review-changed|--clean [file-or-directory ...]",
	);
	process.exit(2);
}

/**
 * textlint で本文全体を検査するファイルの拡張子。
 */
const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);

/**
 * コメントだけ抽出して検査するソースコード。
 *
 * TypeScript の構文解析を利用するため、JavaScript・TypeScript のファイルに限定する。
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
 * OS ごとのパス区切りを、`.textlintignore` との照合用に "/" へ統一する。
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

async function loadTextlintTerms() {
	const configPath = path.join(ROOT, "config", "textlint-terms.json");
	const content = await fs.readFile(configPath, "utf8");

	return JSON.parse(content);
}

/**
 * ファイルの拡張子が検査対象かを判定する。
 */
function isTargetFile(filePath) {
	return TARGET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * リポジトリ全体を走査する。
 *
 * `.gitignore` には依存しない。
 * 校正対象からの除外は `.textlintignore` で決定する。
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
 * `git` コマンドの NUL 区切りの出力を、ファイルパスの配列に変換する。
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
 * Git で変更されたファイルを取得する。
 *
 * HEAD との差分に未追跡ファイルを加える。ステージ済み・未ステージの変更を含める。
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

function printTermIssues(issues) {
	const preferred = issues.filter(
		(issue) => issue.type === "preferred-japanese",
	);
	const unknown = issues.filter((issue) => issue.type === "unknown-english");

	if (preferred.length > 0) {
		console.log("\ntextlint terms:");

		for (const issue of preferred.slice(0, 50)) {
			console.log(
				`${issue.file}:${issue.line}  error  ${issue.term} -> ${issue.suggestion}`,
			);
		}

		if (preferred.length > 50) {
			console.log(`... ${preferred.length - 50} more preferred term issue(s)`);
		}
	}

	if (unknown.length > 0) {
		console.log(
			`textlint terms: ${unknown.length} unknown English occurrence(s) require review.`,
		);

		for (const issue of unknown.slice(0, 20)) {
			console.log(`${issue.file}:${issue.line}  review  ${issue.term}`);
		}

		if (unknown.length > 20) {
			console.log(`... ${unknown.length - 20} more review occurrence(s)`);
		}
	}

	return preferred.length;
}

const targetSpecs = await resolveTextlintTargets(ROOT, process.argv.slice(3));
const ignoreMatcher = await loadTextlintIgnore();

await clearTextlintCacheForScope({
	root: ROOT,
	scope: mode.scope,
});

const candidates = shouldUseChangedFiles(mode.changed, targetSpecs)
	? await getChangedFiles(ignoreMatcher)
	: await getAllFiles(ignoreMatcher);
const files = filterFilesByTargets(candidates, targetSpecs);
const auditItems = [];

if (files.length === 0) {
	console.log("textlint: 対象ファイルはありません。");
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
	 * Markdown・テキスト文書はファイル内容をそのまま検査する。
	 * textlint の診断結果とは別に、日本語文章を静的な用語チェックへ渡す。
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
	 * JavaScript・TypeScript ではコメントだけを抽出する。
	 */
	if (SOURCE_EXTENSIONS.has(extension)) {
		const extracted = extractSourceComments(source, file);

		auditItems.push(...extracted.items);

		if (!JAPANESE_PATTERN.test(extracted.lintText)) {
			continue;
		}

		/**
		 * `.txt` として解析する。インデントなどを Markdown 構文として解釈させない。
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

const termsConfig = await loadTextlintTerms();
const termIssues = findEnglishTermIssues(auditItems, termsConfig);
const issuePath = await writeTextlintIssues({
	root: ROOT,
	scope: mode.scope,
	issues: termIssues,
});
const reviewPath = mode.review
	? await writeTextlintReview({
			root: ROOT,
			scope: mode.scope,
			items: auditItems,
		})
	: null;

/**
 * 診断結果を textlint の `stylish` 形式で表示する。
 */
const formatter = await loadLinterFormatter({
	formatterName: "stylish",
});

const formatted = formatter.format(results);

if (formatted.trim()) {
	console.log(formatted);
}

const preferredIssueCount = printTermIssues(termIssues);

if (issuePath) {
	console.log(
		`textlint issues: ${normalizePath(path.relative(ROOT, issuePath))}`,
	);
}

if (reviewPath) {
	console.log(
		`textlint review: ${normalizePath(path.relative(ROOT, reviewPath))}`,
	);
}

const messageCount = results.reduce(
	(count, result) => count + result.messages.length,
	0,
);

if (messageCount > 0 || preferredIssueCount > 0) {
	process.exitCode = 1;
}
