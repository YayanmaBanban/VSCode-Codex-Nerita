// 実 SDK と認証付き HTTP MCP を接続し、承認・取消し・保存の境界を検証する。
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadTestPiSdk } from "../fixtures/piSdk";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { sandboxFixture } from "../unit/sandboxFixtures";
import { piHttpMcpFixture } from "../fixtures/piHttpMcp";
import { loadPiResources } from "../../apps/vscode-nerita/src/extension/backends/pi/PiResources";
import type { PiAuthorize } from "../../apps/vscode-nerita/src/extension/backends/pi/PiApprovedTools";
import { pending } from "../unit/piHarness";
import { piScriptedTools } from "../fixtures/piScriptedTools";
import { initialState } from "@nerita/shared/chatState";
import { mapPiTool } from "../../apps/vscode-nerita/src/extension/backends/pi/PiToolMapper";
import { restorePiHistory } from "../../apps/vscode-nerita/src/extension/backends/pi/PiHistoryMapper";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

/** 本番と同じリソース読込みへ接続し、会話プロバイダーの通信だけを模擬する。 */
async function fixture(
	networkAccess = true,
	exposure = "direct",
	projectOnly = false,
	oauth = false,
) {
	const sdk = await loadTestPiSdk();
	const files = await sandboxFixture();
	cleanups.push(() => files.cleanup());
	const remote = await piHttpMcpFixture();
	cleanups.push(() => remote.close());
	const abort = new AbortController();
	const authorize = vi.fn<PiAuthorize>((_request, signal) =>
		Promise.resolve(signal ?? abort.signal),
	);
	if (projectOnly) {
		await mkdir(join(files.cwd, ".pi"));
	}
	const configPath = projectOnly
		? join(files.cwd, ".pi/mcp.json")
		: join(files.outside, "mcp.json");
	const config = {
		mcpServers: {
			fixture: {
				url: remote.url,
				enabled: true,
				exposure,
				headers: oauth
					? {}
					: { Authorization: `Bearer ${remote.token}` },
			},
		},
	};
	await writeFile(configPath, JSON.stringify(config));
	if (oauth) {
		const origin = new URL(remote.url).origin;
		await writeFile(
			join(files.outside, "mcp-auth.json"),
			JSON.stringify({
				[remote.url]: {
					serverUrl: remote.url,
					clientInformation: {
						client_id: "fixture-client",
						redirect_uris: ["http://127.0.0.1/callback"],
					},
					tokens: {
						access_token: "fixture-expired-access",
						refresh_token: "fixture-expired-refresh",
						token_type: "Bearer",
					},
					tokensExpireAt: Date.now() - 1,
					discovery: {
						authorizationServerUrl: origin,
						authorizationServerMetadata: {
							issuer: origin,
							authorization_endpoint: `${origin}/authorize`,
							token_endpoint: `${origin}/token`,
							response_types_supported: ["code"],
							token_endpoint_auth_methods_supported: ["none"],
						},
					},
				},
			}),
		);
	}
	const settings = sdk.SettingsManager.inMemory({
		cacheWarming: "off",
		retry: { enabled: false },
		compaction: { enabled: false },
	});
	settings.setProjectTrusted(!projectOnly);
	const registry = new Set<string>();
	const loader = await loadPiResources(
		sdk,
		files.cwd,
		files.outside,
		settings,
		authorize,
		abort.signal,
		undefined,
		[],
		{ ...files.policy, networkAccess },
		undefined,
		"append",
		[],
		{ codemode: true, toolSearch: true, registry },
	);
	const runtime = await sdk.ModelRuntime.create({
		authPath: join(files.outside, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(files.outside, "models.json"),
		refreshOnCreate: false,
	});
	await runtime.setRuntimeApiKey("openai", "fixture-key");
	const manager = sdk.SessionManager.create(
		files.cwd,
		join(files.outside, "sessions"),
	);
	const sessionOptions = {
		cwd: files.cwd,
		agentDir: files.outside,
		settingsManager: settings,
		resourceLoader: loader,
		modelRuntime: runtime,
		model: runtime.getModel("openai", "gpt-6-sol")!,
		sessionManager: manager,
		tools: ["codemode", "tool_search"],
		customTools: [],
		neritaAllowedToolNames: registry,
		neritaActiveToolNames: ["codemode", "tool_search"],
	};
	const { session } = await sdk.createAgentSession(sessionOptions);
	cleanups.push(async () => {
		abort.abort();
		await session.abort();
		session.dispose();
	});
	await session.bindExtensions({ mode: "print" });
	piScriptedTools(session, []);
	await session.prompt("initialize fixture");
	const tool = (name = "mcp__fixture__change") =>
		loader
			.getExtensions()
			.extensions.flatMap((extension) => [...extension.tools.values()])
			.find((item) => item.definition.name === name)!.definition;
	const run = (args: unknown, signal = abort.signal, name?: string) =>
		tool(name).execute(
			"fixture-call",
			args,
			signal,
			undefined,
			{} as unknown as ExtensionToolContext,
		);
	return {
		...files,
		remote,
		sdk,
		session,
		manager,
		loader,
		abort,
		authorize,
		config,
		configPath,
		tool,
		run,
	};
}

it("HTTP接続・直接呼出し・検索・コード内の呼出し・リソースを個別承認し、安全な結果だけを保存する", async () => {
	const h = await fixture(true, "deferred");
	expect(h.authorize).toHaveBeenCalledTimes(1);
	expect(h.session.getActiveToolNames()).not.toContain(
		"mcp__fixture__change",
	);
	piScriptedTools(h.session, [
		{ name: "tool_search", arguments: { query: "change records" } },
		{ name: "mcp__fixture__change", arguments: { path: "direct.txt" } },
		{
			name: "codemode",
			arguments: {
				code: 'text(await tools.mcp__fixture__change({ path: "code.txt" }));',
			},
		},
		{ name: "tool_search", arguments: { query: "read_resource" } },
		{
			name: "mcp__fixture__read_resource",
			arguments: { uri: "fixture://record" },
		},
	]);
	const events: unknown[] = [];
	h.session.subscribe((event) => events.push(event));
	await h.session.prompt("change records");
	expect(h.remote.calls, JSON.stringify(h.session.messages)).toEqual([
		{ name: "change", arguments: { path: "direct.txt" } },
		{ name: "change", arguments: { path: "code.txt" } },
	]);
	expect(h.authorize).toHaveBeenCalledTimes(5);
	expect(JSON.stringify(h.authorize.mock.calls)).not.toContain(
		h.remote.token,
	);
	expect(JSON.stringify(events)).not.toContain(h.remote.token);
	const saved = await readFile(h.manager.getSessionFile()!, "utf8");
	expect(saved).not.toContain(h.remote.token);
	expect(saved).not.toContain('"_meta"');
	expect(saved).toContain("count");
	expect(saved).toContain("nestedCalls");
	const restored = h.sdk.SessionManager.open(h.manager.getSessionFile()!);
	expect(restored.buildSessionContext().messages).toEqual(
		h.manager.buildSessionContext().messages,
	);
	expect(h.remote.calls).toHaveLength(2);
});

it("HTTPツールとリソースの拒否・Stop・承認待ち中の設定変更で未承認の要求を送らない", async () => {
	const h = await fixture();
	h.authorize.mockRejectedValueOnce(new Error("拒否"));
	await expect(h.run({ path: "denied.txt" })).rejects.toThrow();
	h.authorize.mockRejectedValueOnce(new Error("拒否"));
	await expect(
		h.run(
			{ uri: "fixture://record" },
			undefined,
			"mcp__fixture__read_resource",
		),
	).rejects.toThrow();
	const approval = pending<AbortSignal>();
	h.authorize.mockImplementationOnce(() => approval.promise);
	const stop = new AbortController();
	const running = h.run({ path: "cancelled.txt" }, stop.signal);
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalledTimes(4));
	stop.abort();
	approval.resolve(h.abort.signal);
	await expect(running).rejects.toThrow();
	const stale = pending<AbortSignal>();
	h.authorize.mockImplementationOnce(() => stale.promise);
	const changed = h.run({ path: "stale.txt" });
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalledTimes(5));
	h.config.mcpServers.fixture.enabled = false;
	await writeFile(h.configPath, JSON.stringify(h.config));
	stale.resolve(h.abort.signal);
	await expect(changed).rejects.toThrow();
	expect(h.remote.calls).toEqual([]);
});

it("ネットワークを禁止した子と未信頼プロジェクトのHTTP設定を接続しない", async () => {
	const h = await fixture(false);
	expect(h.remote.methods).toEqual([]);
	expect(h.authorize).not.toHaveBeenCalled();
	const untrusted = await fixture(true, "direct", true);
	expect(untrusted.remote.methods).toEqual([]);
	expect(untrusted.authorize).not.toHaveBeenCalled();
});

/** 実行通知と実ファイルを、それぞれ本番のカード変換・履歴復元へ渡す。 */
async function displayedCall(h: Awaited<ReturnType<typeof fixture>>) {
	const state = { ...initialState(), cwd: h.cwd, runId: "mcp-call" };
	const unsubscribe = h.session.subscribe((event) => {
		Object.assign(state, mapPiTool(event, state));
	});
	try {
		piScriptedTools(h.session, [
			{ name: "mcp__fixture__change", arguments: { path: "result.txt" } },
		]);
		await h.session.prompt("change record once");
	} finally {
		unsubscribe();
	}
	const saved = await readFile(h.manager.getSessionFile()!, "utf8");
	const reopened = h.sdk.SessionManager.open(h.manager.getSessionFile()!);
	const restored = restorePiHistory(reopened.getBranch(), h.cwd);
	return { live: state.tools.at(-1), restored: restored.tools.at(-1), saved };
}

it.each([404, 401])(
	"HTTP %sで結果を確定できない操作を再送せず、安全な失敗表示を保存・復元する",
	async (status) => {
		const h = await fixture();
		if (status === 404) {
			h.remote.setExpire();
		} else {
			h.remote.setUnauthorized();
		}
		const result = await displayedCall(h);
		for (const card of [result.live, result.restored]) {
			expect(card?.status).toBe("failed");
			expect(JSON.stringify(card?.content)).toContain(
				"操作が反映されている可能性",
			);
			expect(JSON.stringify(card?.content)).toContain("再実行する前に");
		}
		expect(result.restored?.content).toEqual(result.live?.content);
		expect(result.saved).not.toContain(h.remote.token);
		expect(h.remote.calls).toHaveLength(status === 404 ? 1 : 0);
	},
);

it("動的通知と読取り再接続で定義を更新し、消えたツールと古い承認を使わない", async () => {
	const h = await fixture();
	const old = h.tool();
	await vi.waitFor(() => expect(h.remote.streamCount()).toBeGreaterThan(0));
	h.remote.setTools(["changed"]);
	await vi.waitFor(() =>
		expect(h.tool("mcp__fixture__changed")).toBeDefined(),
	);
	expect(h.tool().exposure).toBe("hidden");
	await expect(
		old.execute(
			"old",
			{ path: "old.txt" },
			h.abort.signal,
			undefined,
			{} as unknown as ExtensionToolContext,
		),
	).rejects.toThrow();
	h.remote.expireResourceOnce();
	const resource = await h.run(
		{ uri: "fixture://record" },
		undefined,
		"mcp__fixture__read_resource",
	);
	expect(JSON.stringify(resource)).toContain("record");
	expect(
		h.remote.methods.filter((method) => method === "initialize"),
	).toHaveLength(2);
	expect(h.remote.calls).toHaveLength(0);
});

it("信頼取消しとHTTP応答待ちのStopを接続へ伝播し、遅い応答を回収する", async () => {
	const h = await fixture();
	h.remote.setSlow();
	const stop = new AbortController();
	const running = h.run({ path: "slow.txt" }, stop.signal);
	await vi.waitFor(() => expect(h.remote.calls).toHaveLength(1));
	stop.abort();
	await expect(running).rejects.toThrow();
	await vi.waitFor(() => expect(h.tool().exposure).toBe("hidden"));
	const trusted = await fixture();
	await trusted.trustStore.setUserTrust(trusted.cwd, false);
	await expect(trusted.run({ path: "revoked.txt" })).rejects.toThrow();
	expect(trusted.remote.calls).toHaveLength(0);
});

it.each([
	{ source: "content", omitted: false, expected: "body" },
	{ source: "content", omitted: true, expected: "body" },
	{ source: "structuredContent", omitted: false, expected: "count" },
	{ source: "structuredContent", omitted: true, expected: "省略" },
] as const)(
	"MCP結果の表示元と省略を保存・復元する: $source omitted=$omitted",
	async ({ source, omitted, expected }) => {
		const h = await fixture();
		h.remote.setOutput(mcpOutput(source, omitted, h.remote.token));
		const result = await displayedCall(h);
		for (const card of [result.live, result.restored]) {
			expect(card?.status).toBe("completed");
			expect(card?.resultDisplay).toEqual({ source, omitted });
			const text = JSON.stringify(card?.content);
			expect(text).toContain(expected);
			expect(text).not.toContain("forged");
			expect(text).not.toContain(h.remote.token);
			expect(text).not.toContain("�");
			if (omitted) {
				expect(text).toContain("省略");
			}
			expect(Buffer.byteLength(text, "utf8")).toBeLessThan(40000);
			if (source === "content") {
				expect(text).not.toContain("count");
			}
		}
		expect(result.restored?.content).toEqual(result.live?.content);
		expect(result.saved).not.toContain(h.remote.token);
		expect(result.saved).not.toContain("forged");
		expect(result.saved).not.toContain('"_meta"');
		expect(h.remote.calls).toHaveLength(1);
	},
);

/** 表示境界を超える実応答に、遠隔側の偽の表示属性と秘密値を混ぜる。 */
function mcpOutput(
	source: "content" | "structuredContent",
	omitted: boolean,
	secret: string,
) {
	return {
		content:
			source === "content"
				? [
						{
							type: "text",
							text: omitted
								? `body ${"日本語".repeat(10000)}${secret}`
								: "body",
						},
					]
				: [],
		structuredContent: omitted
			? {
					oversized: "日本語".repeat(10000),
					token: secret,
					list: Array.from({ length: 1000 }, () => ({
						count: 3,
					})),
				}
			: { count: 3 },
		_meta: { token: secret },
		details: {
			resultDisplay: {
				source: source === "content" ? "structuredContent" : "content",
				omitted: !omitted,
			},
			privateMarker: "forged",
		},
	};
}

it("保存したOAuthの更新先もHost承認を通し、回転後の秘密値を結果へ残さない", async () => {
	const h = await fixture(true, "direct", false, true);
	expect(h.remote.methods).toContain("oauth/token");
	expect(h.authorize).toHaveBeenCalledTimes(2);
	const result = await h.run({ path: "oauth.txt" });
	expect(JSON.stringify(result)).toContain("count");
	expect(JSON.stringify(result)).not.toContain(h.remote.token);
	expect(JSON.stringify(h.authorize.mock.calls)).not.toContain(
		"fixture-expired-refresh",
	);
	expect(await readFile(join(h.outside, "mcp-auth.json"), "utf8")).toContain(
		"fixture-rotated-refresh",
	);
});
