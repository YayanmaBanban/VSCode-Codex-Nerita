// 実 Pi SDK・組み込みフック・ローカルの `Responses` サーバーで、推論設定の変更履歴が送信内容へ反映されることを検証する。
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
import { PiProviderControls } from "../../apps/vscode-nerita/src/extension/backends/pi/PiProviderControls";
import { neritaExtensionFactories } from "../../apps/vscode-nerita/src/extension/backends/pi/PiBuiltinExtensions";
import { oauthToken } from "../unit/piCatalogHarness";
import { normalizeOpenAIModels } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIModelCatalog";

/** HTTP で受け取った要求の検証対象。 */
type WireRequest = {
	reasoning: { effort: string };
	input: {
		type?: string;
		role?: string;
		content?: string | { type: string; text?: string }[];
		reasoning?: { effort: string };
	}[];
	service_tier?: string;
	metadata?: unknown;
	instructions?: string;
	multi_agent?: unknown;
};

/** 新 OAuth の developer 入力へ移されたシステム指示も、実送信の内容として検証する。 */
function instructions(wire: WireRequest): string {
	return [
		wire.instructions ?? "",
		...wire.input
			.filter(
				(item) => item.role === "developer" || item.role === "system",
			)
			.map((item) =>
				typeof item.content === "string"
					? item.content
					: (item.content ?? [])
							.map((part) => part.text ?? "")
							.join("\n"),
			),
	].join("\n");
}

it.each(["gpt-6-astra", "gpt-6-sol"])(
	"実 SDK の %s で通常推論・カタログ由来の Ultra・履歴復元を検証する",
	async (modelId) => {
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
				requests.push(
					JSON.parse(decoded.toString("utf8")) as WireRequest,
				);
				if (failNextResponse) {
					failNextResponse = false;
					response.writeHead(400, {
						"content-type": "application/json",
					});
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
						item: {
							...message,
							status: "in_progress",
							content: [],
						},
					},
					{
						type: "response.content_part.added",
						output_index: 0,
						content_index: 0,
						part: {
							type: "output_text",
							text: "",
							annotations: [],
						},
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
				response.writeHead(200, {
					"content-type": "text/event-stream",
				});
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
					"https://api.openai.com/v1/responses",
				);
				return realFetch(
					`http://127.0.0.1:${address.port}/responses`,
					init,
				);
			},
		);
		let session: AgentSession | undefined;
		try {
			await mkdir(join(directory, ".pi", "extensions"), {
				recursive: true,
			});
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
			runtime.registerProvider("openai", {
				baseUrl: "https://api.openai.com/v1",
				api: "openai-responses",
				apiKey: oauthToken(),
				models: [
					{
						id: modelId,
						name: "Fixture",
						reasoning: true,
						thinkingLevelMap: {
							low: "low",
							medium: "medium",
							high: "high",
							xhigh: "xhigh",
							max: "max",
						},
						input: ["text"],
						contextWindow: 128000,
						maxTokens: 1024,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
						},
					},
				],
			});
			const model = runtime.getModel("openai", modelId)!;
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

			/** 新しい `controls` を生成し、メモリー上の状態なしで既存履歴を復元する。 */
			const open = async (store: SessionManager) => {
				const controls = new PiProviderControls();
				controls.bindDelegation(() => true);
				controls.bindCatalog(() =>
					normalizeOpenAIModels({
						models: [
							{
								slug: modelId,
								display_name: "Fixture",
								visibility: "list",
								service_tiers: [{ id: "priority" }],
								supported_reasoning_levels: [
									"low",
									"high",
									"xhigh",
									"max",
									"ultra",
								].map((effort) => ({ effort })),
								multi_agent_reasoning_effort:
									modelId === "gpt-6-astra" ? "xhigh" : null,
							},
						],
					}),
				);
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
			{
				for (const level of ["low", "high", "low"]) {
					const wire = await send(level, `request-level ${level}`);
					expect(wire.reasoning.effort).toBe(level);
					expect(
						wire.input.some(
							(item) => item.type === "configuration_update",
						),
					).toBe(false);
				}
				current.controls.configure(
					"fast-mode",
					"on",
					new AbortController().signal,
				);
				const ultra = await send("ultra", "request ultra");
				expect(ultra.service_tier).toBe("priority");
				expect(ultra.reasoning.effort).toBe(
					modelId === "gpt-6-astra" ? "xhigh" : "max",
				);
				expect(ultra.multi_agent).toBeUndefined();
				expect(instructions(ultra)).toContain("Ultra mode is enabled");
				current.controls.configure(
					"fast-mode",
					"off",
					new AbortController().signal,
				);
				const normal = await send("low", "return to normal");
				expect(normal.service_tier).toBeUndefined();
				expect(normal.reasoning.effort).toBe("low");
				expect(instructions(normal)).not.toContain(
					"Ultra mode is enabled",
				);
				const file = session.sessionManager.getSessionFile()!;
				session.dispose();
				current = await open(SessionManager.open(file));
				session = current.session;
				const resumed = await send("high", "resumed high");
				expect(resumed.reasoning.effort).toBe("high");
				expect(
					resumed.input.some(
						(item) => item.type === "configuration_update",
					),
				).toBe(false);
				return;
			}
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
	},
	30_000,
);
