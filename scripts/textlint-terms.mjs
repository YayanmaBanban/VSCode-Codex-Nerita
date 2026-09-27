const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const ENGLISH_TOKEN_PATTERN =
	/(?:[A-Za-z][A-Za-z0-9]*(?:[._+#:@-][A-Za-z0-9]+)*|[0-9]+[A-Za-z][A-Za-z0-9]*(?:[._+#:@-][A-Za-z0-9]+)*)/g;

function maskWithSpaces(text, pattern) {
	return text.replace(pattern, (value) => " ".repeat(value.length));
}

/**
 * 識別子・URL・Markdown のリンク先など、英単語チェックの対象外を空白化する。
 */
function maskProtectedText(text) {
	let masked = text;

	masked = maskWithSpaces(masked, /`[^`\r\n]+`/g);
	masked = maskWithSpaces(masked, /https?:\/\/[^\s<>)\]}]+/gi);
	masked = maskWithSpaces(masked, /\]\([^)]+\)/g);

	return masked;
}

/**
 * 日本語文章に裸で混在する英単語を抽出する。
 *
 * `preferredJapanese` はエラー候補、未知語は LLM のレビュー候補として扱う。
 */
export function findEnglishTermIssues(items, config) {
	const allowed = new Set(config.allowedEnglish ?? []);
	const preferred = new Map(
		Object.entries(config.preferredJapanese ?? {}).map(([term, suggestion]) => [
			term.toLowerCase(),
			suggestion,
		]),
	);

	const issues = [];

	for (const item of items) {
		const lines = item.text.split(/\r?\n/);

		for (let index = 0; index < lines.length; index += 1) {
			const text = lines[index];
			const masked = maskProtectedText(text);

			if (!JAPANESE_PATTERN.test(masked)) {
				continue;
			}

			for (const match of masked.matchAll(ENGLISH_TOKEN_PATTERN)) {
				const term = match[0];

				if (allowed.has(term)) {
					continue;
				}

				const suggestion = preferred.get(term.toLowerCase()) ?? null;

				issues.push({
					file: item.file,
					line: item.startLine + index,
					type: suggestion ? "preferred-japanese" : "unknown-english",
					term,
					suggestion,
					text: text.trim(),
				});
			}
		}
	}

	return issues;
}
