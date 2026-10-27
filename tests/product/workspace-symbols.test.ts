// 言語プロバイダーの境界だけを代替し、非同期の再検索・取消し・候補の検証を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as vscode from "vscode";
import { searchWorkspaceSymbols } from "../../apps/vscode-nerita/src/extension/webview/workspaceSymbols";

/** ファイルを探索せず、プロバイダーが候補を返すタイミングだけを再現する。 */
function symbolFixture() {
	const root = join(process.env.NERITA_TEST_ROOT!, randomUUID());
	const definition = localUri(join(root, "custom/definition.lang"));
	const commands: string[] = [];
	let readyAfter = 2;
	let symbols: unknown[] = [
		{
			name: "createPromptSubmitter",
			kind: 11,
			location: {
				uri: definition,
				range: {
					start: { line: 1, character: 0 },
					end: { line: 4, character: 1 },
				},
			},
		},
	];
	Object.assign(vscode.workspace, {
		getWorkspaceFolder: (uri: { fsPath: string }) =>
			uri.fsPath.startsWith(root) ? { uri: localUri(root) } : undefined,
		findFiles: () => {
			throw new Error("検索側でプロジェクトの構成を探索しない");
		},
		openTextDocument: () => {
			throw new Error("検索側で文書を開かない");
		},
	});
	Object.assign(vscode.commands, {
		executeCommand: (command: string) => {
			commands.push(command);
			return Promise.resolve(
				commands.length >= readyAfter ? symbols : [],
			);
		},
	});
	return {
		root,
		definition,
		commands,
		ready: () => {
			readyAfter = 1;
		},
		symbols: (value: unknown[]) => {
			symbols = value;
		},
	};
}

/** VS Code API の URI の値を、実際の file URL として組み立てる。 */
function localUri(fsPath: string) {
	return {
		fsPath,
		scheme: "file",
		query: "",
		fragment: "",
		toString: () => pathToFileURL(fsPath).href,
	};
}

void test("シンボル検索は初期化途中の空結果を待ち、プロジェクト構成を調べずに再検索する", async () => {
	const f = symbolFixture();
	const result = await searchWorkspaceSymbols({
		type: "workspace/searchSymbols",
		requestId: "cold",
		query: "createPromptSubmitter",
	});
	assert.equal(result.entries[0]?.name, "createPromptSubmitter");
	assert.equal(result.entries[0].uri, f.definition.toString());
	assert.ok(f.commands.length > 1);
	assert.ok(
		f.commands.every(
			(command) => command === "vscode.executeWorkspaceSymbolProvider",
		),
	);
});

void test("一致なしは猶予後に正常完了し、検索語変更の取消しは再試行を停止する", async () => {
	const f = symbolFixture();
	f.symbols([]);
	const result = await searchWorkspaceSymbols({
		type: "workspace/searchSymbols",
		requestId: "missing",
		query: "missing",
	});
	assert.equal(result.entries.length, 0);
	assert.equal(result.error, undefined);
	const before = f.commands.length;
	const abort = new AbortController();
	const pending = searchWorkspaceSymbols(
		{
			type: "workspace/searchSymbols",
			requestId: "cancel",
			query: "cancel",
		},
		abort.signal,
	);
	abort.abort();
	await assert.rejects(pending, { name: "AbortError" });
	assert.equal(f.commands.length, before + 1);
});

void test("候補取得済みの検索は再試行せず、空検索は言語プロバイダーを呼ばない", async () => {
	const f = symbolFixture();
	f.ready();
	const found = await searchWorkspaceSymbols({
		type: "workspace/searchSymbols",
		requestId: "warm",
		query: "createPromptSubmitter",
	});
	assert.equal(found.entries.length, 1);
	const empty = await searchWorkspaceSymbols({
		type: "workspace/searchSymbols",
		requestId: "empty",
		query: " ",
	});
	assert.equal(empty.entries.length, 0);
	assert.equal(f.commands.length, 1);
});

void test("シンボル候補はワークスペース内の有効な位置に限定し、重複と上限超過を扱う", async () => {
	const f = symbolFixture();
	f.ready();
	const range = {
		start: { line: 0, character: 0 },
		end: { line: 1, character: 0 },
	};
	const symbol = {
		name: "valid",
		kind: 11,
		location: { uri: f.definition, range },
	};
	f.symbols([
		symbol,
		symbol,
		{
			...symbol,
			location: { uri: localUri(join(f.root, "../outside.ts")), range },
		},
		{
			...symbol,
			location: { uri: { ...f.definition, scheme: "https" }, range },
		},
		{ ...symbol, location: { uri: f.definition } },
	]);
	const valid = await searchWorkspaceSymbols({
		type: "workspace/searchSymbols",
		requestId: "filtered",
		query: "valid",
	});
	assert.equal(valid.entries.length, 1);
	assert.equal(valid.error, undefined);
	f.symbols(
		Array.from({ length: 101 }, (_, index) => ({
			...symbol,
			name: `symbol-${index}`,
		})),
	);
	const limited = await searchWorkspaceSymbols({
		type: "workspace/searchSymbols",
		requestId: "limited",
		query: "symbol",
	});
	assert.equal(limited.entries.length, 100);
	assert.equal(limited.truncated, true);
});
