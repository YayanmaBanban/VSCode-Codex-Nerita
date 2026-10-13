// ファイル先頭の説明を必須にし、本文中のコメントや解析指示による見逃しを防ぐ。

/** 空行・装飾・解析指示だけのコメントは、ファイルの役割の説明として扱わない。 */
function hasDescription(comment) {
	const directive =
		/^(?:eslint(?:-|\s|$)|@ts-(?:ignore|expect-error|nocheck|check)\b|prettier-ignore\b|svelte-ignore\b|(?:istanbul|c8)\s+ignore\b|<reference\b|(?:SPDX-License-Identifier|copyright)\b|@(?:license|copyright|format)\b)/iu;
	return comment.value.split(/\r?\n/u).some((line) => {
		const text = line.replace(/^\s*[*/]+/u, "").trim();
		return /[\p{L}\p{N}]/u.test(text) && !directive.test(text);
	});
}

/** Svelte の先頭 HTML コメントと通常のソースコメントを、元ファイルの位置で並べる。 */
function fileComments(node, sourceCode) {
	const comments = sourceCode
		.getAllComments()
		.filter((comment) => ["Line", "Block"].includes(comment.type));
	const htmlComments = node.body.filter(
		(child) => child.type === "SvelteHTMLComment",
	);
	return [...comments, ...htmlComments].sort(
		(left, right) => left.range[0] - right.range[0],
	);
}

/** 空白と shebang を除き、コードや要素より前のコメントだけでファイルの説明を確認する。 */
function documented(node, sourceCode) {
	const text = sourceCode.text;
	let end = text.startsWith("#!") ? text.indexOf("\n") + 1 : 0;
	for (const comment of fileComments(node, sourceCode)) {
		if (text.slice(end, comment.range[0]).trim()) {
			return false;
		}
		if (hasDescription(comment)) {
			return true;
		}
		end = comment.range[1];
	}
	return false;
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			document:
				"ファイル先頭に、主要な役割を1〜3行で説明するコメントを追加してください。Svelte では先頭の HTML コメントに記述してください。",
		},
	},
	create(context) {
		return {
			Program(node) {
				if (!documented(node, context.sourceCode)) {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: "document",
					});
				}
			},
		};
	},
};
