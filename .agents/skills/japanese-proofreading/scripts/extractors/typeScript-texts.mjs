// 日本語を含む文字列と JSX 本文を、コメントとは別のレビュー項目として抽出する。
import ts from "typescript";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * 静的な文字部分だけを返す。式の評価や文字列の自動修正は行わない。
 * エスケープシーケンスや JSX の文字参照を展開せず、元の行番号を保つ。
 * 日本語のキーなども候補に含むため、修正前に周辺コードと利用箇所の確認が必要。
 */
export function extractSourceTexts(source, filePath) {
	const file = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
	);
	const items = [];

	/** 引用符などの区切りを除いた本文と、元ファイルの行番号を記録する。 */
	function collect(node, kind, openingLength, closingLength) {
		const start =
			(kind === "jsx-text" ? node.pos : node.getStart(file)) +
			openingLength;
		const end = node.end - closingLength;
		const text = source.slice(start, end);
		if (!JAPANESE_PATTERN.test(text)) {
			return;
		}

		items.push({
			file: filePath,
			startLine: file.getLineAndCharacterOfPosition(start).line + 1,
			endLine: file.getLineAndCharacterOfPosition(end - 1).line + 1,
			kind,
			text,
		});
	}

	/** テンプレートの式も個別に調べ、固定部分と連結して文章を作らない。 */
	function visit(node) {
		switch (node.kind) {
			case ts.SyntaxKind.StringLiteral:
				collect(node, "string", 1, 1);
				break;
			case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
			case ts.SyntaxKind.TemplateTail:
				collect(node, "template-text", 1, 1);
				break;
			case ts.SyntaxKind.TemplateHead:
			case ts.SyntaxKind.TemplateMiddle:
				collect(node, "template-text", 1, 2);
				break;
			case ts.SyntaxKind.JsxText:
				collect(node, "jsx-text", 0, 0);
				break;
		}

		ts.forEachChild(node, visit);
	}

	visit(file);
	return items;
}
