// Rust の字句を走査し、文字列とコメントを区別する。マクロの展開や型の解析は行わない。
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
import { scan } from "./rust-lexer.mjs";

/** コメント本文を取り出し、検査時の行・列を元ソースと揃える。 */
export function extractSourceComments(source, filePath) {
	const { comments } = scan(source);
	const output = source
		.split("")
		.map((char) => (/[\r\n]/.test(char) ? char : " "));
	const items = [];
	let line = 1;
	let cursor = 0;
	for (const { start, end, doc, block } of comments) {
		while (cursor < start) {
			if (source[cursor++] === "\n") {
				line++;
			}
		}
		const raw = source.slice(start, end);
		if (!JAPANESE.test(raw)) {
			continue;
		}
		// 入れ子の区切りとブロック行頭の装飾だけを空白にして位置を維持する。
		const body = block
			? raw.replace(/\/\*|\*\//g, "  ").replace(/^(\s*)\*( ?)/gm, "$1 $2")
			: raw;
		for (let j = 0; j < body.length; j++) {
			output[start + j] = body[j];
		}
		items.push({
			file: filePath,
			startLine: line,
			endLine:
				line +
				(source.slice(start, Math.max(start, end - 1)).match(/\n/g)
					?.length ?? 0),
			kind: doc ? "rustdoc" : "comment",
			// 先頭の改行を残し、本文の診断を元の行へ対応させる。
			text: body.replace(/^[^\S\r\n]+/, "").trimEnd(),
		});
	}
	return { lintText: output.join("").replace(/[^\S\r\n]+$/gm, ""), items };
}

/** コメントと文字列を除く字句から、識別子候補を収集する。 */
export function extractSourceIdentifiers(source) {
	return scan(source).identifiers;
}
