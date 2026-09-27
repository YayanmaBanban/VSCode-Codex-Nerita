const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const ENGLISH_TOKEN_PATTERN =
	/(?:[A-Za-z][A-Za-z0-9]*(?:[._+#:@-][A-Za-z0-9]+)*|[0-9]+[A-Za-z][A-Za-z0-9]*(?:[._+#:@-][A-Za-z0-9]+)*)/g;

function maskWithSpaces(text, pattern) {
	return text.replace(pattern, (value) => " ".repeat(value.length));
}

/** 対応する数のバッククォートで囲まれたインラインコードを空白化する。 */
function maskInlineCode(text) {
	const runs = [...text.matchAll(/`+/g)];
	let masked = text;

	for (let index = 0; index < runs.length; index += 1) {
		const opening = runs[index];
		const closingIndex = runs.findIndex(
			(run, candidateIndex) =>
				candidateIndex > index && run[0].length === opening[0].length,
		);

		if (closingIndex < 0) {
			continue;
		}

		const end = runs[closingIndex].index + runs[closingIndex][0].length;
		masked =
			masked.slice(0, opening.index) +
			" ".repeat(end - opening.index) +
			masked.slice(end);
		index = closingIndex;
	}

	return masked;
}

/**
 * 識別子・URL・Markdown のリンク先など、英単語チェックの対象外を空白化する。
 */
function maskProtectedText(text) {
	let masked = maskInlineCode(text);

	masked = maskWithSpaces(masked, /https?:\/\/[^\s<>)\]}]+/gi);
	masked = maskWithSpaces(masked, /\]\([^)]+\)/g);

	return masked;
}

/** 許可語句が、元の文章で空白だけを挟んで連続しているか確認する。 */
function matchesAllowedPhrase(matches, index, phrase, text) {
	if (index + phrase.length > matches.length) {
		return false;
	}

	for (let offset = 0; offset < phrase.length; offset += 1) {
		const match = matches[index + offset];
		const previous = matches[index + offset - 1];

		if (match[0] !== phrase[offset]) {
			return false;
		}

		if (
			offset > 0 &&
			!/^[ \t]+$/.test(
				text.slice(previous.index + previous[0].length, match.index),
			)
		) {
			return false;
		}
	}

	return true;
}

/** 日本語を含む1行から、許可されていない英単語を抽出する。 */
function isTechnicalAcronym(term) {
	return /^[A-Z][A-Z0-9]{1,11}(?:-[A-Z0-9]{1,12})*$/.test(term);
}

function findLineIssues(
	item,
	text,
	line,
	allowed,
	allowedPhrases,
	preferred,
	automaticAllowed,
) {
	const masked = maskProtectedText(text);

	if (!JAPANESE_PATTERN.test(masked)) {
		return [];
	}

	const issues = [];
	const matches = [...masked.matchAll(ENGLISH_TOKEN_PATTERN)];
	for (let index = 0; index < matches.length; index += 1) {
		const phrase = allowedPhrases.find((candidate) =>
			matchesAllowedPhrase(matches, index, candidate, text),
		);

		if (phrase) {
			index += phrase.length - 1;
			continue;
		}

		const match = matches[index];
		const term = match[0];
		const normalizedTerm = term.toLowerCase();
		const suggestion = preferred.get(normalizedTerm) ?? null;

		if (suggestion) {
			issues.push({
				file: item.file,
				line,
				type: "preferred-japanese",
				term,
				suggestion,
				text: text.trim(),
			});
			continue;
		}

		if (
			allowed.has(term) ||
			automaticAllowed.has(normalizedTerm) ||
			isTechnicalAcronym(term)
		) {
			continue;
		}

		issues.push({
			file: item.file,
			line,
			type: "unknown-english",
			term,
			suggestion: null,
			text: text.trim(),
		});
	}

	return issues;
}

/**
 * 日本語文章に裸で混在する英単語を抽出する。
 *
 * `preferredJapanese` はエラー候補、未知語は LLM のレビュー候補として扱う。
 */
export function findEnglishTermIssues(items, config, automaticAllowed = new Set()) {
	const allowed = new Set(config.allowedEnglish ?? []);
	const allowedPhrases = [...allowed]
		.filter((term) => /\s/.test(term))
		.map((term) => term.trim().split(/\s+/))
		.sort((left, right) => right.length - left.length);
	const preferred = new Map(
		Object.entries(config.preferredJapanese ?? {}).map(
			([term, suggestion]) => [term.toLowerCase(), suggestion],
		),
	);

	const issues = [];

	for (const item of items) {
		const lines = item.text.split(/\r?\n/);

		for (let index = 0; index < lines.length; index += 1) {
			issues.push(
				...findLineIssues(
					item,
					lines[index],
					item.startLine + index,
					allowed,
					allowedPhrases,
					preferred,
					automaticAllowed,
				),
			);
		}
	}

	return issues;
}
