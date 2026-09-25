import fs from "node:fs/promises";
import path from "node:path";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * Markdown / TextからLLMレビュー用の日本語ブロックを抽出する。
 *
 * Markdownではフェンスコードブロックを除外する。
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

/**
 * 全日本語文章をLLMレビュー用JSONへ保存する。
 */
export async function writeTextlintAudit({ root, mode, items }) {
	const outputDirectory = path.join(root, ".textlint-cache");

	await fs.mkdir(outputDirectory, {
		recursive: true,
	});

	const modeName = mode === "--changed" ? "changed" : "all";

	const outputPath = path.join(outputDirectory, `audit-${modeName}.json`);

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

	const audit = {
		version: 1,
		mode: modeName,
		generatedAt: new Date().toISOString(),
		itemCount: sortedItems.length,
		items: sortedItems,
	};

	await fs.writeFile(
		outputPath,
		`${JSON.stringify(audit, null, 2)}\n`,
		"utf8",
	);

	return outputPath;
}
