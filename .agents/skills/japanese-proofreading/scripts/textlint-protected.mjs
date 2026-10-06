// 静的な用語・表現検査で共有する保護領域を空白化する。
function maskWithSpaces(text, pattern) {
	return text.replace(pattern, (value) => value.replace(/[^\r\n]/g, " "));
}

/** HTML コメントを、改行位置を保ったまま空白化する。 */
export function maskHtmlComments(text) {
	return text.replace(/<!--[\s\S]*?-->/g, (value) =>
		value.replace(/[^\r\n]/g, " "),
	);
}

/** 対応する数のバッククォートで囲まれたインラインコードを空白化する。 */
function maskInlineCode(text, preserveRealTarget) {
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
		// 対象の識別子は保護しつつ、引用の外にある不自然な接頭辞は検査する。
		const keepMarker =
			preserveRealTarget &&
			/(?<![\p{Script=Han}\w])実[ \t]*$/u.test(
				text.slice(0, opening.index),
			);
		const replacement = text
			.slice(opening.index, end)
			.replace(/[^\r\n]/g, " ");
		masked =
			masked.slice(0, opening.index) +
			(keepMarker ? `\`${replacement.slice(1)}` : replacement) +
			masked.slice(end);
		index = closingIndex;
	}

	return masked;
}

/**
 * 識別子・URL・Markdown のリンク先など、静的検査の対象外を空白化する。
 */
export function maskProtectedText(text, { preserveRealTarget = false } = {}) {
	let masked = maskInlineCode(text, preserveRealTarget);
	// リンクの参照定義全体と非表示の参照識別子を保護し、表示ラベルは検査対象に残す。
	masked = maskWithSpaces(masked, /^ {0,3}\[[^\]\r\n]+\]:[^\r\n]*(?:\r?\n[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)\r\n]*\))[ \t]*)?/gm);
	masked = masked.replace(/(\[[^\]\r\n]+\])\[([^\]\r\n]*)\]/g, (value, label) => label + " ".repeat(value.length - label.length));

	masked = maskWithSpaces(masked, /https?:\/\/[^\s<>)\]}]+/gi);
	masked = maskWithSpaces(masked, /\]\([^)]+\)/g);
	masked = maskWithSpaces(
		masked,
		/\.{1,2}[\\/](?:[\w.@*+-]+[\\/])+[\w.@*+-]*/g,
	);
	masked = maskWithSpaces(
		masked,
		/(?:[\w.@*+-]+[\\/])*[\w.@*+-]+\.(?:jsonl?|toml|ya?ml|md|markdown|txt|text|js|jsx|mjs|cjs|ts|tsx|mts|cts|css|scss|less|html?|svg|png|jpe?g|gif|webp|ico|wasm|xml|csv|lock|log|ini|cfg|conf|env)\b/gi,
	);
	masked = maskWithSpaces(
		masked,
		/(?:^|[\s"'(])\.(?:env|gitignore|npmrc|pnpmfile|prettierrc|textlintrc)\b/gi,
	);
	masked = maskWithSpaces(
		masked,
		/\b\d+(?:\.\d+)?\s*(?:px|rem|em|vh|vw|vmin|vmax|KiB|MiB|GiB|TiB|[Bsh]|KB|MB|GB|TB|ms|min|Hz|kHz|MHz|GHz|dpi|fps)\b/g,
	);
	masked = maskWithSpaces(
		masked,
		/\b(?:Ctrl|Alt|Shift|Meta|Cmd)(?:\+[A-Za-z0-9]+)+\b/g,
	);
	masked = maskWithSpaces(masked, /(?:^|[\s（(])\/[A-Z][\w:-]*/gi);
	masked = maskWithSpaces(masked, /\b[A-Z](?:\/[A-Z])+\b/g);
	masked = maskWithSpaces(masked, /\b[A-Z]{2,}\([A-Z0-9]+\)/g);
	masked = maskWithSpaces(
		masked,
		/\b(?:[A-Za-z][A-Za-z0-9-]*-)?v?\d+(?:\.\d+){1,3}\b/g,
	);

	return masked;
}
