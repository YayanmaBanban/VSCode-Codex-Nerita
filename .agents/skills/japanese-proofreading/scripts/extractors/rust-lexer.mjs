// Rust のコメントと文字列を読み飛ばし、コード中の識別子候補を収集する。
const IDENTIFIER = /(?:r#)?[_\p{XID_Start}]\p{XID_Continue}*/uy;
const RAW_STRING = /(?:br|cr|r)(#{0,255})"/y;
const STRING = /[bc]?"/y;
const CHARACTER =
	/b?'(?:[^'\\\r\n\t]|\\(?:[nrt0\\'"]|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]+\}))'/uy;

/** 入れ子の深さを数えて、ブロックコメントの末尾を返す。 */
function blockEnd(source, start) {
	let i = start + 2;
	let depth = 1;
	while (i < source.length && depth > 0) {
		const pair = source.slice(i, i + 2);
		if (pair === "/*" || pair === "*/") {
			depth += pair === "/*" ? 1 : -1;
			i += 2;
		} else {
			i++;
		}
	}
	if (depth) {
		throw new Error(`Unterminated Rust comment at offset ${start}`);
	}
	return i;
}

/** コメント本文の範囲と、次の字句の開始位置を返す。 */
function readComment(source, i) {
	const pair = source.slice(i, i + 2);
	if (pair !== "//" && pair !== "/*") {
		return null;
	}
	const block = pair === "/*";
	const marker = source[i + 2];
	const outerDoc = block
		? marker === "*" && !["*", "/"].includes(source[i + 3])
		: marker === "/" && source[i + 3] !== "/";
	const doc = marker === "!" || outerDoc;
	const next = block ? blockEnd(source, i) : lineEnd(source, i);
	return {
		start: i + (doc ? 3 : 2),
		end: next - (block ? 2 : 0),
		doc,
		block,
		next,
	};
}

/** CRLF を含む行末を本文に含めない。 */
function lineEnd(source, i) {
	while (i < source.length && !/[\r\n]/.test(source[i])) {
		i++;
	}
	return i;
}

/** エスケープされた引用符を飛ばして文字列末尾を探す。 */
function stringEnd(source, start) {
	let i = start;
	while (i < source.length && source[i] !== '"') {
		i += source[i] === "\\" ? 2 : 1;
	}
	if (i >= source.length) {
		throw new Error(`Unterminated Rust string at offset ${start}`);
	}
	return i + 1;
}

/** 各種文字列・文字リテラルをまとめて読み飛ばす。 */
function literalEnd(source, i) {
	RAW_STRING.lastIndex = i;
	const raw = RAW_STRING.exec(source);
	if (raw) {
		const terminator = `"${raw[1]}`;
		const end = source.indexOf(terminator, RAW_STRING.lastIndex);
		if (end < 0) {
			throw new Error(`Unterminated Rust raw string at offset ${i}`);
		}
		return end + terminator.length;
	}
	STRING.lastIndex = i;
	if (STRING.test(source)) {
		return stringEnd(source, STRING.lastIndex);
	}
	CHARACTER.lastIndex = i;
	return CHARACTER.test(source) ? CHARACTER.lastIndex : i;
}

/** ライフタイムや生識別子の接頭辞を除いて識別子を集める。 */
function identifierEnd(source, i, identifiers) {
	IDENTIFIER.lastIndex = i + (source[i] === "'" ? 1 : 0);
	const token = IDENTIFIER.exec(source);
	if (!token) {
		return i + 1;
	}
	const name = token[0].replace(/^r#/, "");
	if (
		/^[a-z][\da-z]*[A-Z][\dA-Za-z]*$|^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$|^[A-Za-z][A-Za-z0-9]*_\w+$/.test(
			name,
		)
	) {
		identifiers.add(name);
	}
	return IDENTIFIER.lastIndex;
}

/** BOM とスクリプト実行用の先頭行を除く。 */
function sourceStart(source) {
	const i = source.startsWith("\uFEFF") ? 1 : 0;
	return source.startsWith("#!", i) && !source.startsWith("#![", i)
		? lineEnd(source, i)
		: i;
}

/** コメントと識別子を UTF-16 の位置を維持して走査する。 */
export function scan(source) {
	const comments = [];
	const identifiers = new Set();
	let i = sourceStart(source);
	while (i < source.length) {
		const comment = readComment(source, i);
		if (comment) {
			comments.push(comment);
			i = comment.next;
			continue;
		}
		const end = literalEnd(source, i);
		i = end > i ? end : identifierEnd(source, i, identifiers);
	}
	return { comments, identifiers };
}
