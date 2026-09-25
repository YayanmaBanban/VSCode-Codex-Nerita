// 実 Pi SDK・組み込みフック・ローカル Responses サーバーで通信形式履歴を検証する。
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { PiProviderControls } from "../../src/extension/backends/pi/PiProviderControls";
import { neritaExtensionFactories } from "../../src/extension/backends/pi/PiBuiltinExtensions";
import { normalizeCodexModels } from "../../src/extension/backends/pi/codex/CodexModelCatalog";
import { liveModel, oauthToken } from "./piCatalogHarness";

/** HTTP で受け取った要求の検証対象。 */
type WireRequest = {
	reasoning: { effort: string };
	input: { type?: string; reasoning?: { effort: string } }[];
	service_tier?: string;
	metadata?: unknown;
};

it("実SDKの送信・resume・fork・compactionでbaselineと更新順序を保持する", async () => {
	const directory = await mkdtemp(join(tmpdir(), "nerita-reasoning-"));
	const requests: WireRequest[] = [];
	let failNextResponse = false;
	const server = createServer((request, response) => {
		void (async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				chunks.push(Buffer.from(chunk as Uint8Array));
			}
			const body = Buffer.concat(chunks);
			const decoded =
				request.headers["content-encoding"] === "zstd"
					? zstdDecompressSync(body)
					: body;
			requests.push(JSON.parse(decoded.toString("utf8")) as WireRequest);
			if (failNextResponse) {
				failNextResponse = false;
				response.writeHead(400, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						error: { message: "fixture compaction failure" },
					}),
				);
				return;
			}
			const id = `response-${requests.length}`;
			const message = {
				type: "message",
				id: `msg-${requests.length}`,
				role: "assistant",
				status: "completed",
				content: [
					{
						type: "output_text",
						text: "Local response",
						annotations: [],
					},
				],
			};
			const events = [
				{
					type: "response.created",
					response: { id, status: "in_progress" },
				},
				{
					type: "response.output_item.added",
					output_index: 0,
					item: { ...message, status: "in_progress", content: [] },
				},
				{
					type: "response.content_part.added",
					output_index: 0,
					content_index: 0,
					part: { type: "output_text", text: "", annotations: [] },
				},
				{
					type: "response.output_text.delta",
					output_index: 0,
					content_index: 0,
					delta: "Local response",
				},
				{
					type: "response.output_item.done",
					output_index: 0,
					item: message,
				},
				{
					type: "response.completed",
					response: {
						id,
						status: "completed",
						output: [message],
						usage: {
							input_tokens: 20,
							output_tokens: 5,
							total_tokens: 25,
						},
					},
				},
			];
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				events
					.map((event) => `data: ${JSON.stringify(event)}\n\n`)
					.join(""),
			);
		})().catch(() => response.destroy());
	});
	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", resolve),
	);
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing server address");
	}
	const realFetch = globalThis.fetch;
	vi.stubGlobal(
		"fetch",
		(url: string | URL | Request, init?: RequestInit) => {
			expect(url instanceof Request ? url.url : url.toString()).toBe(
				"https://chatgpt.com/backend-api/codex/responses",
			);
			return realFetch(
				`http://127.0.0.1:${address.port}/responses`,
				init,
			);
		},
	);
	let session: AgentSession | undefined;
	try {
		await mkdir(join(directory, ".pi", "extensions"), { recursive: true });
		await writeFile(
			join(directory, ".pi", "extensions", "metadata.ts"),
			'export default function(pi) { pi.on("before_provider_request", event => ({ ...event.payload, metadata: { localExtension: "yes" } })); }',
		);
		const runtime = await ModelRuntime.create({
			authPath: join(directory, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(directory, "models-store.json"),
			refreshOnCreate: false,
		});
		runtime.registerProvider("openai-codex", {
			baseUrl: "https://chatgpt.com/backend-api",
			api: "openai-codex-responses",
			apiKey: oauthToken(),
			models: [
				{
					id: "astra",
					name: "Fixture",
					reasoning: true,
					input: ["text"],
					contextWindow: 128000,
					maxTokens: 1024,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
		});
		const model = runtime.getModel("openai-codex", "astra")!;
		const settings = SettingsManager.inMemory({
			transport: "sse",
			cacheWarming: "off",
			compaction: {
				enabled: false,
				keepRecentTokens: 1,
				reserveTokens: 128,
			},
			retry: { enabled: false, provider: { maxRetries: 0 } },
		});
		const catalog = normalizeCodexModels({
			models: [
				liveModel("astra", {
					supports_reasoning_effort_updates: true,
					supported_reasoning_levels: ["low", "medium", "high"].map(
						(effort) => ({ effort }),
					),
				}),
			],
		});
		/** 新しい `controls` を生成し、メモリー上の状態なしで既存履歴を復元する。 */
		const open = async (store: SessionManager) => {
			const controls = new PiProviderControls();
			controls.bindCatalog(() => catalog);
			const loader = new DefaultResourceLoader({
				cwd: directory,
				agentDir: join(directory, "agent"),
				settingsManager: settings,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				extensionFactories: neritaExtensionFactories(controls),
			});
			await loader.reload();
			const created = await createAgentSession({
				cwd: directory,
				agentDir: join(directory, "agent"),
				modelRuntime: runtime,
				model,
				thinkingLevel: "medium",
				settingsManager: settings,
				resourceLoader: loader,
				sessionManager: store,
				tools: [],
			});
			controls.bind(created.session);
			await created.session.bindExtensions({ mode: "print" });
			return { session: created.session, controls };
		};
		let current = await open(
			SessionManager.create(directory, join(directory, "sessions")),
		);
		session = current.session;
		/** UI 経路で選び、実レスポンスの完了まで待つ。 */
		const send = async (effort: string, prompt: string) => {
			current.controls.selectReasoning(
				effort,
				new AbortController().signal,
			);
			await current.session.prompt(prompt);
			expect(
				current.session.messages.at(-1),
				JSON.stringify(current.session.messages.at(-1)),
			).toMatchObject({
				role: "assistant",
				stopReason: "stop",
			});
			return requests.at(-1)!;
		};
		expect((await send("medium", "one")).reasoning.effort).toBe("medium");
		await send("high", "two");
		const third = await send("low", "three");
		expect(third.reasoning.effort).toBe("medium");
		const efforts = (wire: WireRequest) =>
			wire.input
				.filter((item) => item.type === "configuration_update")
				.map((item) => item.reasoning?.effort);
		expect(efforts(third)).toEqual(["high", "low"]);
		expect(third.metadata).toEqual({ localExtension: "yes" });
		const file = session.sessionManager.getSessionFile()!;
		session.dispose();
		current = await open(SessionManager.open(file));
		session = current.session;
		expect(efforts(await send("low", "resumed"))).toEqual(["high", "low"]);
		session.dispose();
		current = await open(
			SessionManager.forkFrom(file, directory, join(directory, "forks")),
		);
		session = current.session;
		const fork = await send("high", "forked");
		expect(fork.reasoning.effort).toBe("medium");
		expect(efforts(fork)).toEqual(["high", "low", "high"]);
		failNextResponse = true;
		await expect(session.compact()).rejects.toThrow();
		expect(efforts(requests.at(-1)!)).toEqual([]);
		const afterFailure = await send("high", "after failed compaction");
		expect(afterFailure.reasoning.effort).toBe("medium");
		expect(efforts(afterFailure)).toEqual(["high", "low", "high"]);
		await session.compact();
		const compacted = await send("low", "after compaction");
		expect(compacted.reasoning.effort).toBe("low");
		expect(efforts(compacted)).toEqual([]);
		current.controls.configure(
			"fast-mode",
			"on",
			new AbortController().signal,
		);
		const fast = await send("high", "fast");
		expect(fast.service_tier).toBe("priority");
		expect(fast.reasoning.effort).toBe("low");
		expect(efforts(fast)).toEqual(["high"]);
		catalog![0]!.supportsReasoningEffortUpdates = false;
		const unsupported = await send("medium", "unsupported capability");
		expect(unsupported.reasoning.effort).toBe("medium");
		expect(efforts(unsupported)).toEqual([]);
	} finally {
		session?.dispose();
		vi.unstubAllGlobals();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		// `mkdtemp` で作った専用ディレクトリだけを削除する。
		if (
			dirname(resolve(directory)) === resolve(tmpdir()) &&
			basename(directory).startsWith("nerita-reasoning-")
		) {
			await rm(directory, { recursive: true, force: true });
		}
	}
}, 30_000);
