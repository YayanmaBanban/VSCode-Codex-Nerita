// ソースの構文木から日本語コメントを取り出し、元の行と列を維持する。
import ts from "typescript";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/** 文字列・正規表現・テンプレート内の記号をコメントと混同しない。 */
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
		if (!JAPANESE_PATTERN.test(source.slice(start, end))) {
			return;
		}
		const block = kind === ts.SyntaxKind.MultiLineCommentTrivia;
		const contentStart =
			start + (block && source[start + 2] === "*" ? 3 : 2);
		const contentEnd = block ? end - 2 : end;
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
	// コードを置換した末尾空白は除き、文末の誤検出を防ぐ。行と列は変わらない。
	return output.join("").replace(/[^\S\r\n]+$/gm, "");
}
