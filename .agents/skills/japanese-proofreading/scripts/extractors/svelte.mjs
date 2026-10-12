// Svelte のコメント・表示文言・埋め込みコードを構文上の範囲ごとに抽出する。
import { parse } from "svelte/compiler";
import * as typeScript from "./typeScript.mjs";

const JAPANESE_PATTERN =
	/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/** 配列や位置情報から、走査する構文ノードだけを選ぶ。 */
function isSyntaxNode(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof value.type === "string"
	);
}

/** CSS は対象に含めず、公式 AST から本文・コメント・コードの範囲を集める。 */
function collectRanges(source, filePath) {
	const root = parse(source, { filename: filePath, modern: true });
	const comments = root.comments.map((node) => ({
		start: node.start,
		end: node.end,
		block: node.type === "Block",
		html: false,
	}));
	const texts = [];
	const code = [];

	/** JavaScript の部分木は一括して扱い、文字列や式を重複抽出しない。 */
	function visit(node, attribute = false) {
		if (node.name === "style") {
			return;
		}
		if (node.type === "Comment") {
			comments.push({ ...node, html: true, block: true });
			return;
		}
		if (node.type === "Text") {
			texts.push({
				...node,
				kind: attribute ? "svelte-attribute" : "svelte-text",
			});
			return;
		}
		// ESTree のノードだけが loc を持つ。Svelte のタグやブロックはその子を調べる。
		if (node.loc && Number.isInteger(node.start)) {
			code.push({
				start: node.start,
				end: node.end,
				expression: !node.type.endsWith("Declaration"),
			});
			return;
		}

		for (const child of Object.values(node).flat().filter(isSyntaxNode)) {
			visit(child, attribute || node.type === "Attribute");
		}
	}

	visit(root.fragment);
	for (const script of [root.module, root.instance]) {
		if (script) {
			code.push({
				start: script.content.start,
				end: script.content.end,
				expression: false,
			});
		}
	}

	return { comments, texts, code };
}

/** 元ソースの UTF-16 オフセットから行番号を引く。CRLF と絵文字でも位置を保つ。 */
function createLineLocator(source) {
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === "\n") {
			starts.push(index + 1);
		}
	}

	return (offset) => {
		let low = 0;
		let high = starts.length;
		while (low + 1 < high) {
			const middle = Math.floor((low + high) / 2);
			if (starts[middle] <= offset) {
				low = middle;
			} else {
				high = middle;
			}
		}
		return low + 1;
	};
}

/** 区切りを除き、診断に必要な先頭の改行を残してコメントを整形する。 */
function readComment(source, comment) {
	if (comment.html) {
		const start = comment.start + 4;
		const end = comment.end - 3;
		return {
			start,
			end,
			kind: "comment",
			text: source
				.slice(start, end)
				.replace(/^[^\S\r\n]+/, "")
				.trimEnd(),
		};
	}

	const jsdoc = comment.block && source[comment.start + 2] === "*";
	const start = comment.start + (jsdoc ? 3 : 2);
	const end = comment.end - (comment.block ? 2 : 0);
	const raw = source.slice(start, end);
	const text = comment.block
		? raw
				.split(/\r?\n/)
				.map((line) => line.replace(/^\s*\*\s?/, ""))
				.join("\n")
				.replace(/^[^\S\r\n]+/, "")
				.trimEnd()
		: raw.trim();
	return { start, end, kind: jsdoc ? "jsdoc" : "comment", text };
}

/** コメント本文だけを textlint に渡し、元の行と列を維持する。 */
export function extractSourceComments(source, filePath) {
	const { comments } = collectRanges(source, filePath);
	const lineAt = createLineLocator(source);
	const output = source
		.split("")
		.map((char) => (char === "\n" || char === "\r" ? char : " "));
	const items = [];

	for (const comment of comments.sort(
		(left, right) => left.start - right.start,
	)) {
		const { start, end, kind, text } = readComment(source, comment);
		if (!JAPANESE_PATTERN.test(text)) {
			continue;
		}
		items.push({
			file: filePath,
			startLine: lineAt(start),
			endLine: lineAt(Math.max(start, end - 1)),
			kind,
			text,
		});
		for (let index = start; index < end; index += 1) {
			output[index] = source[index];
		}
	}

	return { lintText: output.join("").replace(/[^\S\r\n]+$/gm, ""), items };
}

/** 静的な本文・属性値と、script・テンプレート式内の文字列を別々に返す。 */
export function extractSourceTexts(source, filePath) {
	const { texts, code } = collectRanges(source, filePath);
	const lineAt = createLineLocator(source);
	const items = texts
		.filter((node) =>
			JAPANESE_PATTERN.test(source.slice(node.start, node.end)),
		)
		.map((node) => ({
			position: node.start,
			item: {
				file: filePath,
				startLine: lineAt(node.start),
				endLine: lineAt(node.end - 1),
				kind: node.kind,
				text: source.slice(node.start, node.end),
			},
		}));

	for (const range of code.sort((left, right) => left.start - right.start)) {
		const snippet = source.slice(range.start, range.end);
		// オブジェクトや関数の式を文として誤解釈しないよう、式だけ括弧で囲む。
		const input = range.expression ? `(${snippet})` : snippet;
		const offset = lineAt(range.start) - 1;
		for (const item of typeScript.extractSourceTexts(
			input,
			`${filePath}.ts`,
		)) {
			items.push({
				position: range.start,
				item: {
					...item,
					file: filePath,
					startLine: item.startLine + offset,
					endLine: item.endLine + offset,
				},
			});
		}
	}

	return items
		.sort((left, right) => left.position - right.position)
		.map(({ item }) => item);
}

/** script とテンプレート式に実在する識別子だけを既存の規則で収集する。 */
export function extractSourceIdentifiers(source, filePath) {
	const { code } = collectRanges(source, filePath);
	const identifiers = new Set();
	for (const range of code) {
		const snippet = source.slice(range.start, range.end);
		const input = range.expression ? `(${snippet})` : snippet;
		for (const identifier of typeScript.extractSourceIdentifiers(
			input,
			`${filePath}.ts`,
		)) {
			identifiers.add(identifier);
		}
	}
	return identifiers;
}
