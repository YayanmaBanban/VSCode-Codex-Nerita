import fs from "node:fs/promises";
import path from "node:path";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const IGNORE_START = /^<!--\s*texlint-ignore-start\s*-->$/u;
const IGNORE_END = /^<!--\s*texlint-ignore-end\s*-->$/u;

/**
 * 文書の無効化範囲を、診断行番号が変わらないよう改行以外の空白へ置き換える。
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
	const lines = source.split(/\r?\n/);
	const markdown = /\.(?:md|markdown)$/i.test(filePath);

	const items = [];

	let buffer = [];
	let startLine = null;
	let inCodeFence = false;
	let fenceMarker = null;

	function flush(endLine) {
		if (buffer.length === 0 || startLine === null) {
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
		const fenceMatch = markdown ? trimmed.match(/^(```+|~~~+)/) : null;

		if (fenceMatch) {
			const marker = fenceMatch[1][0];

			if (!inCodeFence) {
				flush(index);
				inCodeFence = true;
				fenceMarker = marker;
			} else if (marker === fenceMarker) {
				inCodeFence = false;
				fenceMarker = null;
			}

			continue;
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
 * 同じ範囲の古い監査結果を消し、校正前の内容が次回へ残らないようにする。
 */
export async function clearTextlintCacheForScope({ root, scope }) {
	await Promise.all([
		removeIfExists(cachePath(root, "issues", scope, "json")),
		removeIfExists(cachePath(root, "review", scope, "jsonl")),
	]);
}

/**
 * textlint の一時監査ファイルをすべて削除する。
 */
export async function cleanTextlintCache(root) {
	await fs.rm(path.join(root, ".textlint-cache"), {
		recursive: true,
		force: true,
	});
}

function groupIssues(issues) {
	const groups = new Map();

	for (const issue of issues) {
		const key = `${issue.type}\0${issue.term}\0${issue.suggestion ?? ""}`;
		let group = groups.get(key);

		if (!group) {
			group = {
				type: issue.type,
				term: issue.term,
				suggestion: issue.suggestion,
				occurrenceCount: 0,
				occurrences: [],
			};
			groups.set(key, group);
		}

		group.occurrenceCount += 1;

		if (group.occurrences.length < 20) {
			group.occurrences.push({
				file: issue.file,
				line: issue.line,
				text: issue.text,
			});
		}
	}

	return [...groups.values()].sort((left, right) => {
		const typeComparison = left.type.localeCompare(right.type);

		return typeComparison !== 0
			? typeComparison
			: left.term.localeCompare(right.term);
	});
}

/**
 * 靁的チェックで見つけた候補だけを、小さな JSON として保存する。
 * 同じ英単語はまとめ、保存する出現例は最大20件に抑える。
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
 * 明示的な LLM レビュー時だけ、全日本語文章を JSONL で保存する。
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
