// 文字列をコメントと誤認する不具合と、元コードの位置がずれる不具合を検出する。
import assert from "node:assert/strict";
import test from "node:test";
import {
	extractSourceComments,
	extractSourceIdentifiers,
	extractSourceTexts,
	SOURCE_EXTENSIONS,
} from "../scripts/extractors/index.mjs";

test("Rust strings and lifetimes do not hide or create comments", () => {
	const source = [
		'let text_value = "// 文字列 fake_name";',
		'let raw_value = r##""# /* 生文字列 hidden_name */"##;',
		'let bytes_value = br#"// バイト文字列"#;',
		'let c_value = cr#"/* C文字列 */"#;',
		'let escaped_value = "\\" // 文字列";',
		"let char_value = '\"'; let byte_value = b'\\'';",
		"fn read_value<'long_life>(value: &'long_life str) { // 値を読む。",
		"} // 処理を終える。",
	].join("\r\n");
	const { items, lintText } = extractSourceComments(source, "sample.rs");
	assert.deepEqual(
		items.map(({ text, startLine }) => [text, startLine]),
		[
			["値を読む。", 7],
			["処理を終える。", 8],
		],
	);
	assert.equal(
		lintText.split("\r\n")[6].indexOf("値"),
		source.split("\r\n")[6].indexOf("値"),
	);
	const identifiers = extractSourceIdentifiers(source, "sample.rs");
	assert(identifiers.has("read_value"));
	assert(!identifiers.has("fake_name"));
	assert(!identifiers.has("hidden_name"));
});

test("Rust nested comments and documentation retain text and positions", () => {
	const source =
		'let emoji = "😀"; /* 外側 /* 内側 */ 続き */\n//! 内部の説明。\n/// 外部の説明。\n/*! ブロックの説明。 */\n/** 型の説明。 */\nlet r#some_value = 1;';
	const { items, lintText } = extractSourceComments(source, "sample.rs");
	assert.equal(items.length, 5);
	assert.match(items[0].text, /外側\s+内側\s+続き/);
	assert.equal(
		lintText.split("\n")[0].indexOf("外側"),
		source.indexOf("外側"),
	);
	assert.deepEqual(
		items.slice(1).map((item) => [item.kind, item.startLine]),
		[
			["rustdoc", 2],
			["rustdoc", 3],
			["rustdoc", 4],
			["rustdoc", 5],
		],
	);
	assert(extractSourceIdentifiers(source, "sample.rs").has("some_value"));
	for (const invalid of ["/* 未完了", 'r##"未完了"#', '"未完了']) {
		assert.throws(
			() => extractSourceComments(invalid, "sample.rs"),
			/Unterminated Rust/,
		);
	}
});

test("TypeScript routing preserves JSX and literal exclusions", () => {
	const source =
		'const realName = "// 文字列 fake_name";\nconst view = <div>// 表示文字列{/* コメント。 */}</div>;\n/** 関数の説明。 */\nfunction readValue() {}';
	const { items } = extractSourceComments(source, "sample.tsx");
	assert.deepEqual(
		items.map((item) => item.text),
		["コメント。", "関数の説明。"],
	);
	assert.equal(items[1].kind, "jsdoc");
	assert.equal(items[1].startLine, 3);
	const identifiers = extractSourceIdentifiers(source, "sample.tsx");
	assert(identifiers.has("readValue"));
	assert(!identifiers.has("fake_name"));
	assert(SOURCE_EXTENSIONS.has(".rs"));
	assert.throws(() => extractSourceComments("", "sample.py"), /Unsupported/);
});

test("Japanese log and error strings retain positions across JavaScript and TypeScript extensions", () => {
	const source = [
		'const emoji = "😀"; console.log("実 Webview: 起動に成功");',
		'throw new Error("実 Webview の起動に失敗しました。");',
		'const command = "git status", event = "webview.ready";',
		'const file = "./sample.ts", key = "処理済み";',
		'const escaped = "引用\\"を示す\\n次の行";',
		"const regex = /日本語/; // コメントだけ。",
	].join("\r\n");
	for (const extension of [
		"ts",
		"tsx",
		"mts",
		"cts",
		"js",
		"jsx",
		"mjs",
		"cjs",
	]) {
		const file = `sample.${extension}`;
		assert.deepEqual(extractSourceTexts(source, file), [
			{
				file,
				startLine: 1,
				endLine: 1,
				kind: "string",
				text: "実 Webview: 起動に成功",
			},
			{
				file,
				startLine: 2,
				endLine: 2,
				kind: "string",
				text: "実 Webview の起動に失敗しました。",
			},
			{
				file,
				startLine: 4,
				endLine: 4,
				kind: "string",
				text: "処理済み",
			},
			{
				file,
				startLine: 5,
				endLine: 5,
				kind: "string",
				text: '引用\\"を示す\\n次の行',
			},
		]);
	}
	assert.deepEqual(extractSourceTexts(source, "sample.rs"), []);
	assert.throws(() => extractSourceTexts(source, "sample.py"), /Unsupported/);
});

test("JSX text, attributes and both conditional branches are extracted separately from comments", () => {
	const source = [
		"/** 表示の説明。 */",
		'const view = <div title="再接続">接続を再試行します',
		'{followUp ? "フォローアップを送信" : "チャットを送信"}',
		"{/* コメント。 */}{`接続を確認します`}</div>;",
	].join("\n");
	for (const file of ["sample.tsx", "sample.jsx"]) {
		assert.deepEqual(
			extractSourceTexts(source, file).map(
				({ kind, text, startLine, endLine }) => [
					kind,
					text,
					startLine,
					endLine,
				],
			),
			[
				["string", "再接続", 2, 2],
				["jsx-text", "接続を再試行します\n", 2, 2],
				["string", "フォローアップを送信", 3, 3],
				["string", "チャットを送信", 3, 3],
				["template-text", "接続を確認します", 4, 4],
			],
		);
		assert.deepEqual(
			extractSourceComments(source, file).items.map(({ text }) => text),
			["表示の説明。", "コメント。"],
		);
	}
});

test("template fragments preserve multiline source positions without evaluating or joining expressions", () => {
	const source = [
		"const label = `静的な説明`;",
		"const message = `処理を開始します。${",
		'  dangerousCall("式内の文字列") /* 式のコメント。 */',
		"} 続きを確認します。${count}",
		"処理を終了します。`;",
		"const value = `English ${count} 日本語`;",
	].join("\r\n");
	assert.deepEqual(
		extractSourceTexts(source, "sample.ts").map(
			({ kind, text, startLine, endLine }) => [
				kind,
				text,
				startLine,
				endLine,
			],
		),
		[
			["template-text", "静的な説明", 1, 1],
			["template-text", "処理を開始します。", 2, 2],
			["string", "式内の文字列", 3, 3],
			["template-text", " 続きを確認します。", 4, 4],
			["template-text", "\r\n処理を終了します。", 4, 5],
			["template-text", " 日本語", 6, 6],
		],
	);
	assert.deepEqual(
		extractSourceComments(source, "sample.ts").items.map(
			({ text }) => text,
		),
		["式のコメント。"],
	);
});
