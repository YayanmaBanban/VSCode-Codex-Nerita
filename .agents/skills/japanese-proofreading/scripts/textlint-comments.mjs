// ソースの構文木から日本語コメントを取り出し、元の行と列を維持する。
import ts from "typescript";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * 監査用の JSON ファイルへ保存するコメント本文を整形する。
 */
function normalizeCommentText(text, block) {
	if (!block) {
		return text.trim();
	}

	return text
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*\*\s?/, ""))
		.join("\n")
		.trim();
}

/**
 * 日本語コメントを抽出する。
 *
 * `lintText` は元ソースのコメントの行・列を維持した textlint 用の文字列。
 * `items` は LLM による意味レビュー用の全日本語コメント。
 */
export function extractSourceComments(source, filePath) {
	const file = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
	);

	// 構文木と同じ UTF-16 コード単位で扱い、絵文字以降の位置ずれを防ぐ。
	const output = source
		.split("")
		.map((char) => (char === "\n" || char === "\r" ? char : " "));

	const items = [];
	const visited = new Set();
	const jsxTextRanges = [];

	/** タグ直後の表示文字列を、直前のトークンに続くコメントと誤認させない。 */
	function collectJsxText(node) {
		if (node.kind === ts.SyntaxKind.JsxText) {
			jsxTextRanges.push([node.pos, node.end]);
		}

		ts.forEachChild(node, collectJsxText);
	}

	collectJsxText(file);

	/** 同じコメントを重複処理せず、日本語の本文だけを残す。 */
	function copyComment(start, end, kind) {
		if (
			visited.has(start) ||
			jsxTextRanges.some(([from, to]) => start >= from && start < to)
		) {
			return;
		}

		visited.add(start);

		const rawComment = source.slice(start, end);

		if (!JAPANESE_PATTERN.test(rawComment)) {
			return;
		}

		const block = kind === ts.SyntaxKind.MultiLineCommentTrivia;
		const jsdoc = block && source[start + 2] === "*";

		const contentStart = start + (jsdoc ? 3 : 2);
		const contentEnd = block ? Math.max(contentStart, end - 2) : end;

		const rawText = source.slice(contentStart, contentEnd);
		const text = normalizeCommentText(rawText, block);

		if (!JAPANESE_PATTERN.test(text)) {
			return;
		}

		const startPosition = file.getLineAndCharacterOfPosition(contentStart);
		const endPosition = file.getLineAndCharacterOfPosition(
			Math.max(contentStart, contentEnd - 1),
		);

		items.push({
			file: filePath,
			startLine: startPosition.line + 1,
			endLine: endPosition.line + 1,
			kind: jsdoc ? "jsdoc" : "comment",
			text,
		});

		for (let index = contentStart; index < contentEnd; index += 1) {
			output[index] = source[index];
		}
	}

	/** 末尾のコメントや式の途中も、構文上のトークン境界から取得する。 */
	function visit(node) {
		if (node.kind === ts.SyntaxKind.JsxText) {
			return;
		}

		const children = node.getChildren(file);

		if (children.length > 0) {
			children.forEach(visit);
			return;
		}

		// 文字列・テンプレート・正規表現の本文はコメントとして探索しない。
		ts.forEachLeadingCommentRange(source, node.pos, copyComment);
		ts.forEachTrailingCommentRange(source, node.end, copyComment);
	}

	visit(file);

	// コードを空白に置換した後の行末の空白を除き、文末の誤検出を防ぐ。コメントの行と列は変わらない。
	const lintText = output.join("").replace(/[^\S\r\n]+$/gm, "");

	return {
		lintText,
		items,
	};
}
