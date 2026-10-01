// 同梱 SDK の組み込み拡張を使い、許可・承認・停止・保存の境界を確認する。
import { loadTestPiSdk } from "../fixtures/piSdk";
import type {
	ExtensionToolContext,
	ToolDefinition,
	Extension,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { loadPiResources } from "../../apps/vscode-nerita/src/extension/backends/pi/PiResources";
import { sandboxFixture } from "../unit/sandboxFixtures";
import {
	approvePiTool,
	type PiAuthorize,
} from "../../apps/vscode-nerita/src/extension/backends/pi/PiApprovedTools";
import { pending } from "../unit/piHarness";
import { guardPiExtensionTools } from "../../apps/vscode-nerita/src/extension/backends/pi/PiExtensionTools";
import { piToolExposure } from "../../apps/vscode-nerita/src/extension/backends/pi/PiToolFeatures";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

/** 配布用の実ファクトリーを、検証用の一時会話へロードする。 */
async function fixture(allowedTools?: string[]) {
	const sdk = await loadTestPiSdk();
	const files = await sandboxFixture();
	fixtures.push(files);
	const abort = new AbortController();
	const authorize = vi.fn<PiAuthorize>((_request, signal) =>
		Promise.resolve(signal ?? abort.signal),
	);
	const loader = await loadPiResources(
		sdk,
		files.cwd,
		files.outside,
		sdk.SettingsManager.inMemory(),
		authorize,
		abort.signal,
		undefined,
		[],
		files.policy,
		undefined,
		"append",
		[],
		{
			codemode: true,
			toolSearch: true,
			allowedTools,
			secrets: () => Promise.resolve(["fixture-private-value"]),
		},
	);
	const tools = loader
		.getExtensions()
		.extensions.flatMap((extension) =>
			[...extension.tools.values()].map((tool) => tool.definition),
		);
	const code = tools.find((tool) => tool.name === "codemode")!;
	const writes: unknown[] = [];
	// ファクトリーの `appendEntry` は実際の共有 runtime を通す。
	loader.getExtensions().runtime.appendEntry = (_type, data) => {
		writes.push(data);
	};
	const context = {
		tools: [],
		sessionManager: { getBranch: () => [] },
		executeTool: vi.fn(),
	} as unknown as ExtensionToolContext;
	const run = (source: string, ctx = context) =>
		code.execute("code", { code: source }, abort.signal, undefined, ctx);
	return {
		...files,
		sdk,
		abort,
		authorize,
		loader,
		tools,
		code,
		context,
		run,
		writes,
	};
}

it("設定で有効にし、MCPなしでも検索とcodemodeを登録する", async () => {
	const h = await fixture();
	expect(h.tools.map((tool) => tool.name)).toEqual([
		"codemode",
		"tool_search",
	]);
	expect(h.tools.every((tool) => tool.defaultActive)).toBe(true);
	const result = await h.run(
		"text({ models: typeof models, process: typeof process, fetch: typeof fetch });",
	);
	expect(result.isError).toBeFalsy();
	expect(JSON.stringify(result)).toContain('\\"models\\":\\"undefined\\"');
});

it("子の許可リストにない組み込み機能は登録しない", async () => {
	const h = await fixture(["codemode", "read"]);
	expect(h.tools.map((tool) => tool.name)).toEqual(["codemode"]);
	const context: ExtensionToolContext = {
		...h.context,
		tools: [
			{
				name: "forbidden",
				description: "private",
				label: "private",
				parameters: { type: "object", properties: {} },
				execute: vi.fn(),
			},
		],
	};
	expect(
		JSON.stringify(await h.run("text(ALL_TOOLS);", context)),
	).not.toContain("forbidden");
});

it("コードの承認だけで子を実行せず、実引数に対する拒否を反映する", async () => {
	const h = await fixture();
	const execute = vi.fn<ToolDefinition["execute"]>(() =>
		Promise.resolve({
			content: [{ type: "text", text: "changed" }],
			details: {},
		}),
	);
	const target = approvePiTool(
		{
			name: "fixture_change",
			label: "change",
			description: "change records",
			parameters: { type: "object", properties: {} },
			execute,
		},
		h.cwd,
		h.authorize,
		h.policy,
		h.abort.signal,
	);
	h.authorize
		.mockResolvedValueOnce(h.abort.signal)
		.mockRejectedValueOnce(new Error("拒否"));
	const context = {
		...h.context,
		tools: [target],
		executeTool: async (
			_name: string,
			args: unknown,
			options?: { signal?: AbortSignal },
		) => {
			return {
				toolCallId: "code/1",
				result: await target.execute(
					"code/1",
					args,
					options?.signal,
					undefined,
					h.context,
				),
				isError: false,
			};
		},
	} as unknown as ExtensionToolContext;
	const result = await h.run(
		'await tools.fixture_change({ path: "actual.txt" });',
		context,
	);
	expect(result.isError).toBe(true);
	expect(h.authorize).toHaveBeenCalledTimes(2);
	expect(JSON.stringify(h.authorize.mock.calls[1]![0])).toContain(
		"actual.txt",
	);
	expect(execute).not.toHaveBeenCalled();
});

it("期限を延ばすコードでも承認待ちを60秒で停止する", async () => {
	const h = await fixture();
	vi.useFakeTimers();
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValueOnce(gate.promise);
	const result = h.run('// @options: {"timeout_ms": 999999}\ntext("late");');
	const rejected = expect(result).rejects.toThrow();
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalledOnce());
	expect(h.authorize).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(60000);
	gate.resolve(h.abort.signal);
	await rejected;
});

it.each([
	'text("x".repeat(32769));',
	'console.log("x".repeat(32769));',
	'return "x".repeat(32769);',
	'store("too_big", "x".repeat(16385));',
	"for(let i=0; i<129; i++) store(String(i), i);",
])("実Workerで出力・storeの上限を守る: %s", async (source) => {
	const h = await fixture();
	const result = await h.run(source);
	expect(result.isError).toBe(true);
	expect(JSON.stringify(result).length).toBeLessThan(40000);
	expect(h.writes).toEqual([]);
});

it("秘密値を結果・store・更新イベントへ残さない", async () => {
	const h = await fixture();
	const update = vi.fn();
	const result = await h.code.execute(
		"private",
		{
			code: 'store("saved", "fixture-private-value"); text("fixture-private-value"); return { token: "opaque-private" };',
		},
		h.abort.signal,
		update,
		h.context,
	);
	expect(result.isError).toBeFalsy();
	const serialized = JSON.stringify([result, h.writes, update.mock.calls]);
	expect(serialized).not.toContain("fixture-private-value");
	expect(serialized).not.toContain("opaque-private");
	expect(serialized).toContain("非公開");
});

it("検索は許可済み定義だけを有効化し、実行の承認は省略しない", async () => {
	const h = await fixture(["codemode", "tool_search", "fixture_change"]);
	const execute = vi.fn();
	const target = piToolExposure(
		{
			name: "fixture_change",
			label: "change",
			description: "change records",
			parameters: { type: "object", properties: {} },
			execute,
		},
		{ toolSearch: true },
	);
	let active = ["codemode", "tool_search"];
	const runtime = h.loader.getExtensions().runtime;
	const info = {
		...target,
		exposure: "deferred" as const,
		sourceInfo: h.loader.getExtensions().extensions[0]!.sourceInfo,
	};
	runtime.getAllTools = () => [info, { ...info, name: "forbidden" }];
	runtime.getActiveTools = () => active;
	runtime.setActiveTools = (names) => {
		active = names;
	};
	const search = h.tools.find((tool) => tool.name === "tool_search")!;
	const result = await search.execute(
		"search",
		{ query: "change records" },
		h.abort.signal,
		undefined,
		h.context,
	);
	expect(result.details).toEqual({ loaded: ["fixture_change"] });
	expect(active).toEqual(["codemode", "tool_search", "fixture_change"]);
	expect(execute).not.toHaveBeenCalled();
	expect(h.authorize).not.toHaveBeenCalled();
});

it("ロード後の登録も許可と承認を通し、組み込みの上書きを拒否する", async () => {
	const h = await fixture();
	const extension: Extension = {
		...h.loader.getExtensions().extensions[0]!,
		path: "fixture-extension",
		tools: new Map(),
	};
	const registry = new Set<string>();
	guardPiExtensionTools(
		extension,
		h.cwd,
		h.authorize,
		h.policy,
		h.abort.signal,
		{
			allowedTools: ["fixture_change", "read"],
			toolSearch: true,
			registry,
		},
		[],
	);
	const execute = vi.fn<ToolDefinition["execute"]>(() =>
		Promise.resolve({
			content: [{ type: "text", text: "changed" }],
			details: {},
		}),
	);
	const definition: ToolDefinition = {
		name: "fixture_change",
		label: "change",
		description: "change records",
		parameters: { type: "object", properties: {} },
		execute,
	};
	const sourceInfo = h.loader.getExtensions().extensions[0]!.sourceInfo;
	extension.tools.set("forbidden", {
		definition: { ...definition, name: "forbidden" },
		sourceInfo,
	});
	expect(extension.tools.has("forbidden")).toBe(false);
	extension.tools.set(definition.name, { definition, sourceInfo });
	expect(registry.has(definition.name)).toBe(true);
	const registered = extension.tools.get(definition.name)!.definition;
	expect(registered.exposure).toBe("deferred");
	h.authorize.mockRejectedValueOnce(new Error("拒否"));
	await expect(
		registered.execute(
			"dynamic",
			{ actual: 7 },
			h.abort.signal,
			undefined,
			h.context,
		),
	).rejects.toThrow("拒否");
	expect(execute).not.toHaveBeenCalled();
	expect(() =>
		extension.tools.set("read", {
			definition: { ...definition, name: "read" },
			sourceInfo,
		}),
	).toThrow("上書き");
});

it.each(["count", "concurrency"])(
	"実Workerの子呼出し%sの上限と取消しを守る",
	async (mode) => {
		const h = await fixture();
		let count = 0;
		const signals: AbortSignal[] = [];
		const target: ToolDefinition = {
			name: "fixture_count",
			label: "count",
			description: "count records",
			parameters: { type: "object", properties: {} },
			execute: vi.fn(),
		};
		const context = {
			...h.context,
			tools: [target],
			executeTool: (
				_name: string,
				_args: unknown,
				options?: { signal?: AbortSignal },
			) => {
				count++;
				if (options?.signal) {
					signals.push(options.signal);
				}
				return mode === "count"
					? Promise.resolve({
							toolCall: {
								type: "toolCall",
								id: `code/${count}`,
								name: "fixture_count",
								arguments: {},
							},
							isError: false,
							result: {
								content: [{ type: "text", text: "counted" }],
								details: {},
							},
						})
					: pending().promise;
			},
		} as unknown as ExtensionToolContext;
		const code =
			mode === "count"
				? "for(let i=0; i<33; i++) await tools.fixture_count({});"
				: "await Promise.all(Array.from({length:5}, () => tools.fixture_count({})));";
		expect((await h.run(code, context)).isError).toBe(true);
		expect(count).toBe(mode === "count" ? 32 : 4);
		if (mode === "concurrency") {
			expect(signals.every((signal) => signal.aborted)).toBe(true);
		}
	},
);

it("Stopは実行中の子呼出しへ伝播する", async () => {
	const h = await fixture();
	let childSignal: AbortSignal | undefined;
	const context = {
		...h.context,
		tools: [
			{
				name: "fixture_wait",
				description: "wait",
				parameters: { type: "object", properties: {} },
			},
		],
		executeTool: (
			_name: string,
			_args: unknown,
			options?: { signal?: AbortSignal },
		) => {
			childSignal = options?.signal;
			return pending().promise;
		},
	} as unknown as ExtensionToolContext;
	const running = h.run("await tools.fixture_wait({});", context);
	await vi.waitFor(() => expect(childSignal).toBeDefined());
	h.abort.abort();
	expect((await running).isError).toBe(true);
	expect(childSignal?.aborted).toBe(true);
});

it("指定した小さい出力予算で省略し、全出力をファイルへ保存しない", async () => {
	const h = await fixture();
	const result = await h.run(
		'// @options: {"max_output_tokens": 10}\ntext("x".repeat(1000));',
	);
	expect(result.isError).toBeFalsy();
	expect(JSON.stringify(result)).toContain("no file was written");
	expect(result.details).not.toHaveProperty("fullOutputPath");
});
