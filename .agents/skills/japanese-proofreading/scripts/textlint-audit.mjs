import fs from "node:fs/promises";
import path from "node:path";
import { maskHtmlComments } from "./textlint-protected.mjs";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const IGNORE_START = /^<!--\s*texlint-ignore-start\s*-->$/u;
const IGNORE_END = /^<!--\s*texlint-ignore-end\s*-->$/u;

/**
 * 文書の検査対象外の範囲を、診断行番号が変わらないよう改行を残して空白に置き換える。
 */
export function maskIgnoredDocument(source, filePath) {
	let ignored = false;
	let startLine = null;
	const lines = source.split(/(?<=\n)/u);
	const masked = lines.map((line, index) => {
		const marker = line.trim();

		const endsIgnore = IGNORE_END.test(marker);

		if (IGNORE_START.test(marker)) {
			if (ignored) {
				throw new Error(
					`nested texlint-ignore-start: ${filePath}:${index + 1}`,
				);
			}

			ignored = true;
			startLine = index + 1;
		} else if (endsIgnore) {
			if (!ignored) {
				throw new Error(
					`unmatched texlint-ignore-end: ${filePath}:${index + 1}`,
				);
			}

			ignored = false;
		}

		return ignored || endsIgnore ? line.replace(/[^\r\n]/g, " ") : line;
	});

	if (ignored) {
		throw new Error(
			`unclosed texlint-ignore-start: ${filePath}:${startLine}`,
		);
	}

	return masked.join("");
}

/**
 * Markdown・テキスト文書から LLM によるレビュー用の日本語ブロックを抽出する。
 *
 * Markdown ではフェンスコードブロックを除外する。
 * 空行を文章ブロックの境界として扱う。
 */
export function extractDocumentAuditItems(source, filePath) {
	const lines = maskHtmlComments(source).split(/\r?\n/);
	const markdown = /\.(?:md|markdown)$/i.test(filePath);

	const items = [];

	let buffer = [];
	let startLine = null;
	let inCodeFence = false;
	let fenceMarker = null;
	let fenceLength = 0;

	function flush(endLine) {
		if (buffer.length === 0) {
			return;
		}

		const text = buffer.join("\n").trim();

		if (text && JAPANESE_PATTERN.test(text)) {
			items.push({
				file: filePath,
				startLine,
				endLine,
				kind: "document",
				text,
			});
		}

		buffer = [];
		startLine = null;
	}

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();
		const fenceMatch = readFence(line, markdown);

		if (fenceMatch) {
			const marker = fenceMatch[1][0];

			if (!inCodeFence && validFenceOpening(marker, fenceMatch[2])) {
				flush(index);
				inCodeFence = true;
				fenceMarker = marker;
				fenceLength = fenceMatch[1].length;
				continue;
			} else if (closesFence(fenceMatch, fenceMarker, fenceLength)) {
				inCodeFence = false;
				fenceMarker = null;
				fenceLength = 0;
				continue;
			}
		}

		if (inCodeFence) {
			continue;
		}

		if (!trimmed) {
			flush(index);
			continue;
		}

		if (startLine === null) {
			startLine = index + 1;
		}

		buffer.push(line);
	}

	flush(lines.length);

	return items;
}

/** フェンス記号を先に読み取り、後続の情報文字列とのバックトラックを避ける。 */
function readFence(line, markdown) {
	if (!markdown) {
		return null;
	}
	const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
	return match ? [match[0], match[1], line.slice(match[0].length)] : null;
}

/** バッククォートの開始フェンスでは、後続の情報文字列にバッククォートを含められない。 */
function validFenceOpening(marker, info) {
	return marker !== "`" || !info.includes("`");
}

/** 開始フェンスと同じ記号が同数以上続き、後ろに空白以外がないことを確認する。 */
function closesFence(match, marker, length) {
	return match[1][0] === marker && match[1].length >= length && !match[2].trim();
}

function cachePath(root, type, scope, extension) {
	return path.join(root, ".textlint-cache", `${type}-${scope}.${extension}`);
}

async function removeIfExists(filePath) {
	try {
		await fs.unlink(filePath);
	} catch (error) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
	}
}

/**
 * 保存区分（`changed` / `all`）が同じ古い指摘・レビュー用データを削除する。
 */
export async function clearTextlintCacheForScope({ root, scope }) {
	await Promise.all([
		removeIfExists(cachePath(root, "issues", scope, "json")),
		removeIfExists(cachePath(root, "review", scope, "jsonl")),
	]);
}

/**
 * 検査結果・レビュー用データ・取得済みの技術辞書を含むキャッシュをすべて削除する。
 */
export async function cleanTextlintCache(root) {
	await fs.rm(path.join(root, ".textlint-cache"), {
		recursive: true,
		force: true,
	});
}

function groupingTerm(issue) {
	return issue.type === "unquoted-identifier"
		? issue.term
		: issue.term.toLowerCase();
}

function groupIssues(issues) {
	const groups = new Map();

	for (const issue of issues) {
		const normalizedTerm = groupingTerm(issue);
		const key = `${issue.type}\0${normalizedTerm}\0${issue.suggestion ?? ""}`;
		let group = groups.get(key);

		if (!group) {
			group = {
				type: issue.type,
				term: issue.term,
				normalizedTerm,
				suggestion: issue.suggestion,
				variants: new Set(),
				occurrenceCount: 0,
				occurrences: [],
			};
			groups.set(key, group);
		}

		group.variants.add(issue.term);
		group.occurrenceCount += 1;

		if (group.occurrences.length < 20) {
			group.occurrences.push({
				file: issue.file,
				line: issue.line,
				text: issue.text,
			});
		}
	}

	const grouped = [...groups.values()].map((group) => {
		const variants = [...group.variants].sort((left, right) =>
			left.localeCompare(right),
		);
		const preferredTerm =
			group.type === "unquoted-identifier"
				? group.term
				: (variants.find(
						(variant) => variant === group.normalizedTerm,
					) ?? group.term);
		const output = {
			type: group.type,
			term: preferredTerm,
			suggestion: group.suggestion,
			occurrenceCount: group.occurrenceCount,
			occurrences: group.occurrences,
		};

		if (variants.length > 1) {
			output.variants = variants;
		}

		return output;
	});

	return grouped.sort((left, right) => {
		const typeComparison = left.type.localeCompare(right.type);

		return typeComparison !== 0
			? typeComparison
			: left.term.localeCompare(right.term);
	});
}

/**
 * 静的チェックで見つけた指摘を、種類・語・推奨表記または診断メッセージでまとめて JSON に保存する。
 * 出現例は候補ごとに最大20件まで保存する。
 */
export async function writeTextlintIssues({ root, scope, issues }) {
	if (issues.length === 0) {
		return null;
	}

	const outputDirectory = path.join(root, ".textlint-cache");
	await fs.mkdir(outputDirectory, { recursive: true });

	const outputPath = cachePath(root, "issues", scope, "json");
	const groupedIssues = groupIssues(issues);
	const payload = {
		version: 2,
		scope,
		issueCount: issues.length,
		termCount: groupedIssues.length,
		issues: groupedIssues,
	};

	await fs.writeFile(
		outputPath,
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);

	return outputPath;
}

/**
 * 明示的な LLM レビュー時だけ、抽出した日本語の文章を JSONL で保存する。
 * 1項目1行にして、巨大な整形済み JSON を避ける。
 */
export async function writeTextlintReview({ root, scope, items }) {
	if (items.length === 0) {
		return null;
	}

	const outputDirectory = path.join(root, ".textlint-cache");
	await fs.mkdir(outputDirectory, { recursive: true });

	const outputPath = cachePath(root, "review", scope, "jsonl");
	const sortedItems = [...items].sort((left, right) => {
		const fileComparison = left.file.localeCompare(right.file);

		if (fileComparison !== 0) {
			return fileComparison;
		}

		if (left.startLine !== right.startLine) {
			return left.startLine - right.startLine;
		}

		return left.endLine - right.endLine;
	});

	const lines = [
		JSON.stringify({
			record: "meta",
			version: 2,
			scope,
			itemCount: sortedItems.length,
		}),
		...sortedItems.map((item) =>
			JSON.stringify({
				record: "item",
				...item,
			}),
		),
	];

	await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

	return outputPath;
}
