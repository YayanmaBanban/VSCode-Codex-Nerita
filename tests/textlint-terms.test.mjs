import assert from "node:assert/strict";
import test from "node:test";

import { findEnglishTermIssues } from "../scripts/textlint-terms.mjs";

const config = {
	allowedEnglish: ["API", "TypeScript"],
	preferredJapanese: {
		owner: "担当テスト",
	},
};

test("classifies bare English while ignoring code, URLs, links, and allowed terms", () => {
	const items = [
		{
			file: "docs/policy.md",
			startLine: 10,
			endLine: 15,
			kind: "document",
			text: [
				"既存の owner を使う。",
				"未知の fooBar を確認する。",
				"`role` を正規化する。",
				"API と TypeScript を使う。",
				"詳細は https://example.com/fooBar を参照する。",
				"[UI レビュー](UI-Review-Guide.md) を参照する。",
			].join("\n"),
		},
	];

	assert.deepEqual(findEnglishTermIssues(items, config, new Set(["owner"])), [
		{
			file: "docs/policy.md",
			line: 10,
			type: "preferred-japanese",
			term: "owner",
			suggestion: "担当テスト",
			text: "既存の owner を使う。",
		},
		{
			file: "docs/policy.md",
			line: 11,
			type: "unknown-english",
			term: "fooBar",
			suggestion: null,
			text: "未知の fooBar を確認する。",
		},
		{
			file: "docs/policy.md",
			line: 15,
			type: "unknown-english",
			term: "UI",
			suggestion: null,
			text: "[UI レビュー](UI-Review-Guide.md) を参照する。",
		},
	]);
});

test("allows complete multiword terms without hiding partial or interrupted matches", () => {
	const lines = [
		"Unreal Engine と VS Code を使う。",
		"Unreal  Engine を使う。",
		"Unreal Engines を使う。",
		"Unreal `ignored` Engine を使う。",
		"SuperUnreal Engine を使う。",
	];
	const items = [
		{
			file: "docs/engines.md",
			startLine: 10,
			text: lines.join("\n"),
		},
	];
	const issues = findEnglishTermIssues(items, {
		allowedEnglish: ["Unreal Engine", "VS Code"],
	});

	assert.deepEqual(
		issues.map(({ line, term }) => ({ line, term })),
		[
			{ line: 12, term: "Unreal" },
			{ line: 12, term: "Engines" },
			{ line: 13, term: "Unreal" },
			{ line: 13, term: "Engine" },
			{ line: 14, term: "SuperUnreal" },
			{ line: 14, term: "Engine" },
		],
	);
});

test("ignores English inside matching multi-backtick code spans", () => {
	const lines = [
		"``owner`` と ``fooBar`` を確認する。",
		"`` `nested` owner `` と plain を確認する。",
		"```owner``` と visible を確認する。",
		"``owner` と bare を確認する。",
	];
	const issues = findEnglishTermIssues(
		[
			{
				file: "docs/code.md",
				startLine: 10,
				text: lines.join("\n"),
			},
		],
		config,
	);

	assert.deepEqual(
		issues.map(({ line, term }) => ({ line, term })),
		[
			{ line: 11, term: "plain" },
			{ line: 12, term: "visible" },
			{ line: 13, term: "owner" },
			{ line: 13, term: "bare" },
		],
	);
});

test("allows automatic technical terms and uppercase acronyms but keeps preferred Japanese", () => {
	const items = [
		{
			file: "docs/tooling.md",
			startLine: 1,
			text: [
				"exports と Node と pnpm と dist を使う。",
				"CPU と ESM と WASM と CJS と SHA-256 を扱う。",
				"owner は自動辞書に含まれていても日本語を優先する。",
			].join("\n"),
		},
	];
	const automaticAllowed = new Set([
		"exports",
		"node",
		"pnpm",
		"dist",
		"owner",
	]);

	assert.deepEqual(findEnglishTermIssues(items, config, automaticAllowed), [
		{
			file: "docs/tooling.md",
			line: 3,
			type: "preferred-japanese",
			term: "owner",
			suggestion: "担当テスト",
			text: "owner は自動辞書に含まれていても日本語を優先する。",
		},
	]);
});

test("ignores measurements and common technical notation", () => {
	const items = [
		{
			file: "docs/measurements.md",
			startLine: 1,
			text: [
				"320px / 1100px で表示を確認する。",
				"応答サイズは 32KiB、本文は 2 MiB までとする。",
				"余白は 1.5rem、高さは 100vh とする。",
				"Ctrl+F と I/O と HTTP(S) を確認する。",
				"v5.0.8 と rust-v0.157.0 を比較する。",
			].join("\n"),
		},
	];

	assert.deepEqual(findEnglishTermIssues(items, { allowedEnglish: [] }), []);
});

test("ignores file names and repository paths without hiding ordinary dotted terms", () => {
	const items = [
		{
			file: "docs/files.md",
			startLine: 1,
			text: [
				"config.toml と guardrails.json と models-manager/models.json を使う。",
				"./docs/working_memory/ に保存する。",
				"reasoning.effort は確認する。",
			].join("\n"),
		},
	];

	assert.deepEqual(
		findEnglishTermIssues(items, { allowedEnglish: [] }).map(({ term }) => term),
		["reasoning.effort"],
	);
});

test("allows package names discovered from repository evidence", () => {
	const items = [
		{
			file: "docs/packages.md",
			startLine: 1,
			text: "pi-web-access と pi-subagents を使い、request-level は確認する。",
		},
	];
	const automaticAllowed = new Set(["pi-web-access", "pi-subagents"]);

	assert.deepEqual(
		findEnglishTermIssues(items, { allowedEnglish: [] }, automaticAllowed).map(({ term }) => term),
		["request-level"],
	);
});


test("ignores known command and key names plus slash commands", () => {
	const items = [
		{
			file: "docs/commands.md",
			startLine: 1,
			text: [
				"ls と gh と chcp を使う。",
				"Backspace と Tab と Undo を確認する。",
				"/plan で計画を開始する。",
			].join("\n"),
		},
	];

	assert.deepEqual(findEnglishTermIssues(items, { allowedEnglish: [] }), []);
});

test("reports real identifier-shaped source names as unquoted identifiers", () => {
	const items = [
		{
			file: "docs/identifiers.md",
			startLine: 1,
			text: [
				"agentDir 配下へ保存する。",
				"AgentViewer を開く。",
				"Plan を開く。",
				"`agentDir` 配下なら問題ない。",
			].join("\n"),
		},
	];
	const sourceIdentifiers = new Set(["agentDir", "AgentViewer"]);

	assert.deepEqual(
		findEnglishTermIssues(
			items,
			{ allowedEnglish: [] },
			new Set(),
			sourceIdentifiers,
		).map(({ type, term, suggestion }) => ({ type, term, suggestion })),
		[
			{
				type: "unquoted-identifier",
				term: "agentDir",
				suggestion: "`agentDir`",
			},
			{
				type: "unquoted-identifier",
				term: "AgentViewer",
				suggestion: "`AgentViewer`",
			},
			{
				type: "unknown-english",
				term: "Plan",
				suggestion: null,
			},
		],
	);
});

test("preferred Japanese still wins over repository identifiers", () => {
	const items = [
		{
			file: "docs/preferred.md",
			startLine: 1,
			text: "owner を確認する。",
		},
	];

	assert.equal(
		findEnglishTermIssues(
			items,
			config,
			new Set(),
			new Set(["owner"]),
		)[0].type,
		"preferred-japanese",
	);
});


test("ignores inline and multiline HTML comments", () => {
	const items = [
		{
			file: "docs/generated.md",
			startLine: 1,
			text: [
				'本文です。<!-- :chatgpt-content-reference{index="0"} -->',
				"<!-- internal-marker",
				"generated metadata",
				"-->",
				"outsideWord は確認する。",
			].join("\n"),
		},
	];

	assert.deepEqual(
		findEnglishTermIssues(items, { allowedEnglish: [] }).map(({ line, term }) => ({
			line,
			term,
		})),
		[{ line: 5, term: "outsideWord" }],
	);
});
