import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import ignore from "ignore";
import ts from "typescript";

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
 * TypeScript scannerを利用するため、
 * JS / TS系に限定する。
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

const SOURCE_COMMENT_TOKENS = new Set([
	ts.SyntaxKind.SingleLineCommentTrivia,
	ts.SyntaxKind.MultiLineCommentTrivia,
]);

/**
 * Windowsのパス区切りも
 * .textlintignore用に "/" へ統一する。
 */
function normalizePath(filePath) {
	return filePath.split(path.sep).join("/");
}

/**
 * .textlintignoreを読み込む。
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
 * .gitignoreには依存しない。
 * lint除外は.textlintignoreだけで決定する。
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
			 * symlinkは追跡しない。
			 *
			 * リポジトリ外へ走査が広がることや、
			 * ディレクトリループを防ぐ。
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
 * gitコマンドを実行し、
 * NUL区切りのファイル一覧を返す。
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
 * HEADとの差分:
 * - staged
 * - unstaged
 *
 * さらにuntrackedを追加する。
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
 * 拡張子に対応する TypeScript のスキャナーを作成する。
 */
function createSourceScanner(source, filePath) {
	const extension = path.extname(filePath).toLowerCase();

	const languageVariant =
		extension === ".tsx" || extension === ".jsx"
			? ts.LanguageVariant.JSX
			: ts.LanguageVariant.Standard;

	return ts.createScanner(
		ts.ScriptTarget.Latest,
		false,
		languageVariant,
		source,
	);
}

/**
 * コメント本文の範囲を取得する。
 */
function getCommentContentRange(source, scanner, token) {
	if (!SOURCE_COMMENT_TOKENS.has(token)) {
		return null;
	}

	const start = scanner.getTokenPos();
	const end = scanner.getTextPos();
	const rawComment = source.slice(start, end);

	/**
	 * 日本語を含まないコメントは
	 * 今回の日本語lintでは無視する。
	 */
	if (!JAPANESE_PATTERN.test(rawComment)) {
		return null;
	}

	const isBlockComment = token === ts.SyntaxKind.MultiLineCommentTrivia;

	/**
	 * // または /*
	 * の2文字を除外する。
	 */
	let contentStart = start + 2;

	/**
	 * /** ... *\/ の場合は
	 * 先頭の追加 "*" も除外する。
	 */
	if (isBlockComment && source[contentStart] === "*") {
		contentStart += 1;
	}

	/**
	 * block comment末尾の *\/ を除く。
	 */
	const contentEnd = isBlockComment ? Math.max(contentStart, end - 2) : end;

	return { contentStart, contentEnd };
}

/**
 * コメント本文を同じ文字位置へ転写する。
 */
function copyCommentContent(source, output, contentRange) {
	for (
		let index = contentRange.contentStart;
		index < contentRange.contentEnd;
		index += 1
	) {
		const char = source[index];

		if (char === "\n" || char === "\r") {
			continue;
		}

		output[index] = char;
	}
}

/**
 * JS / TSソースからコメントだけを残す。
 *
 * コメント以外は空白へ置換する。
 * 改行と文字位置は維持するため、
 * textlintのline/columnを元ソースと一致させられる。
 */
function extractSourceComments(source, filePath) {
	const chars = [...source];

	const output = chars.map((char) =>
		char === "\n" || char === "\r" ? char : " ",
	);

	const scanner = createSourceScanner(source, filePath);

	while (true) {
		const token = scanner.scan();

		if (token === ts.SyntaxKind.EndOfFileToken) {
			break;
		}

		const contentRange = getCommentContentRange(source, scanner, token);

		if (contentRange !== null) {
			copyCommentContent(source, output, contentRange);
		}
	}

	return output.join("");
}

/**
 * lint対象を取得する。
 */
const ignoreMatcher = await loadTextlintIgnore();

const files =
	mode === "--changed"
		? await getChangedFiles(ignoreMatcher)
		: await getAllFiles(ignoreMatcher);

if (files.length === 0) {
	console.log("textlint: 対象ファイルはありません。");

	process.exit(0);
}

/**
 * .textlintrc.jsonを読み込む。
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
	 * ファイル内容をそのままlintする。
	 */
	if (DOCUMENT_EXTENSIONS.has(extension)) {
		const result = await linter.lintText(source, file);

		results.push(result);
		continue;
	}

	/**
	 * JS / TS
	 *
	 * コメントだけを抽出する。
	 */
	if (SOURCE_EXTENSIONS.has(extension)) {
		const commentText = extractSourceComments(source, file);

		if (!JAPANESE_PATTERN.test(commentText)) {
			continue;
		}

		/**
		 * .txtとして解析することで、
		 * ソースコード上のインデントなどを
		 * Markdown構文として解釈させない。
		 */
		const result = await linter.lintText(commentText, `${file}.txt`);

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
 * 通常のtextlintと同じstylish形式。
 */
const formatter = await loadLinterFormatter({
	formatterName: "stylish",
});

const formatted = formatter.format(results);

if (formatted.trim()) {
	console.log(formatted);
}

const messageCount = results.reduce(
	(count, result) => count + result.messages.length,
	0,
);

if (messageCount > 0) {
	process.exitCode = 1;
}
