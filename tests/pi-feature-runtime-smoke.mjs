// 同梱 runtime だけでローカル検索の送信形式と QuickJS の資産を確認し、実認証の受入とは区別する。
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extensionRoot } from "../config/workspace-paths.cjs";

/** 権限で除外した候補を検索へ渡さず、選んだ定義を追加宣言として送信する。 */
export async function verifyPiLocalSearch(sdk, directory) {
	const deferred = {
		name: "mcp_fixture_count",
		description: "Count fixture records",
		parameters: { type: "object", properties: {} },
		exposure: "deferred",
	};
	let active = ["tool_search"];
	let search;
	sdk.createToolSearchExtension()({
		registerTool: (definition) => {
			search = definition;
		},
		getAllTools: () => [deferred],
		getActiveTools: () => active,
		setActiveTools: (names) => {
			active = names;
		},
	});
	const result = await search.execute("local-search", {
		query: "count records",
	});
	assert.deepEqual(result.details.loaded, [deferred.name]);
	assert.deepEqual(active, ["tool_search", deferred.name]);
	await writeFile(
		path.join(directory, "auth.json"),
		JSON.stringify({
			openai: {
				type: "oauth",
				access: "fixture-new-oauth",
				refresh: "unused",
				clientId: "fixture",
				expires: Date.now() + 3600000,
			},
		}),
	);
	const runtime = await sdk.ModelRuntime.create({
		authPath: path.join(directory, "auth.json"),
		modelsPath: null,
		modelsStorePath: path.join(directory, "models-store.json"),
		refreshOnCreate: false,
	});
	assert.equal((await runtime.checkAuth("openai")).type, "oauth");
	const model = runtime.getModel("openai", "gpt-6-sol");
	assert.ok(model);
	let payload;
	let fetches = 0;
	const context = {
		messages: [
			{
				role: "system",
				content: "Fixture",
				toolsAdded: [
					{
						name: search.name,
						description: search.description,
						parameters: search.parameters,
					},
				],
				timestamp: 1,
			},
			{ role: "user", content: "Count records", timestamp: 2 },
			{
				role: "system",
				content: "",
				toolsAdded: [deferred],
				timestamp: 3,
			},
		],
	};
	const message = await runtime.completeSimple(model, context, {
		transport: "sse",
		onPayload: (value) => {
			payload = value;
			throw new Error("fixture-payload-captured");
		},
		fetch: () => {
			fetches++;
			throw new Error("unexpected-network");
		},
	});
	assert.equal(message.stopReason, "error");
	assert.equal(fetches, 0);
	assert.ok(
		payload.input.some(
			(item) =>
				item.type === "additional_tools" &&
				item.tools.some(
					(tool) =>
						tool.type === "function" && tool.name === deferred.name,
				),
		),
	);
	assert.ok(
		payload.tools.some(
			(tool) => tool.type === "function" && tool.name === "tool_search",
		),
	);
	assert.ok(!payload.tools.some((tool) => tool.type === "tool_search"));
	assert.ok(!JSON.stringify(payload).includes("defer_loading"));
	assert.equal(payload.store, false);
	assert.equal(payload.stream, true);
	// API Key でも同じローカル検索を使い、通常の function 宣言に定義を追加する。
	await writeFile(
		path.join(directory, "auth.json"),
		JSON.stringify({
			openai: { type: "api_key", key: "sk-fixture-api-key" },
		}),
	);
	const apiRuntime = await sdk.ModelRuntime.create({
		authPath: path.join(directory, "auth.json"),
		modelsPath: null,
		modelsStorePath: path.join(directory, "api-models-store.json"),
		refreshOnCreate: false,
	});
	assert.equal((await apiRuntime.checkAuth("openai")).type, "api_key");
	let apiPayload;
	const apiMessage = await apiRuntime.completeSimple(
		apiRuntime.getModel("openai", "gpt-6-sol"),
		context,
		{
			transport: "sse",
			onPayload: (value) => {
				apiPayload = value;
				throw new Error("fixture-api-payload-captured");
			},
			fetch: () => {
				fetches++;
				throw new Error("unexpected-network");
			},
		},
	);
	assert.ok(apiPayload, apiMessage.errorMessage);
	payload = apiPayload;
	assert.equal(fetches, 0);
	assert.ok(
		payload.tools.some(
			(tool) => tool.type === "function" && tool.name === deferred.name,
		),
		JSON.stringify({
			tools: payload.tools.map((tool) => ({
				type: tool.type,
				name: tool.name,
			})),
			inputTypes: payload.input.map((item) => item.type),
		}),
	);
	assert.ok(
		payload.tools.some(
			(tool) => tool.type === "function" && tool.name === "tool_search",
		),
	);
	assert.ok(!payload.tools.some((tool) => tool.type === "tool_search"));
	assert.ok(!JSON.stringify(payload).includes("defer_loading"));
}

/** 開発時の依存を参照しない配布ファクトリーからワーカーを実行する。 */
async function verifyQuickJS(sdk) {
	let tool;
	sdk.createCodemodeExtension({ models: false })({
		registerTool: (definition) => {
			tool = definition;
		},
	});
	const result = await tool.execute(
		"quickjs-fixture",
		{
			code: '// @options: {"timeout_ms": 3000}\ntext({ process:typeof process, fetch:typeof fetch, models:typeof models });',
		},
		new AbortController().signal,
		undefined,
		{
			tools: [],
			sessionManager: { getBranch: () => [] },
		},
	);
	assert.ok(
		result.content.some(
			(item) =>
				item.type === "text" &&
				item.text.includes('"process":"undefined"'),
		),
	);
	assert.ok(
		result.content.some(
			(item) =>
				item.type === "text" &&
				item.text.includes('"models":"undefined"'),
		),
	);
	assert.ok(!result.isError);
	const signal = new AbortController();
	const running = tool.execute(
		"quickjs-stop",
		{ code: "while(true) {}" },
		signal.signal,
		undefined,
		{ tools: [], sessionManager: { getBranch: () => [] } },
	);
	const timer = setTimeout(() => signal.abort(), 100);
	try {
		const stopped = await running;
		assert.equal(stopped.isError, true);
		assert.match(
			stopped.content.map((part) => part.text).join("\n"),
			/Script aborted:/,
		);
	} finally {
		clearTimeout(timer);
	}
}

/** VSIX 展開先も引数で受け取り、検証専用の認証ファイルだけを使う。 */
async function main() {
	const extensionPath = path.resolve(process.argv[2] ?? extensionRoot);
	const sdk = await import(
		pathToFileURL(path.join(extensionPath, "dist/runtime/pi.mjs")).href
	);
	const root = await realpath(
		await mkdtemp(path.join(tmpdir(), "nerita-pi-features-")),
	);
	try {
		await verifyPiLocalSearch(sdk, root);
		await verifyQuickJS(sdk);
		const mcp = await sdk.loadPiMcp();
		assert.equal(typeof mcp.McpServerConnection, "function");
		assert.equal(typeof mcp.validateMcpServerConfig, "function");
		console.log(
			"PASS: 配布 runtime のローカル BM25 / additional_tools / QuickJS 実行・Stop / MCP アダプター読込み",
		);
	} finally {
		assert.equal(path.dirname(root), await realpath(tmpdir()));
		assert.ok(path.basename(root).startsWith("nerita-pi-features-"));
		await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	await main();
}
