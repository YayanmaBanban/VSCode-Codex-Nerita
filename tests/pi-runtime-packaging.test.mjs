// 開発ツリー外の実バンドルで、プロバイダー・動的読込み・相対資産の配布契約を検証する。
import { repoRoot } from "../config/workspace-paths.cjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { test } from "node:test";
import packaging from "../config/package-pi.cjs";
import plugin from "../config/pi-bundle-plugin.cjs";
import contract from "../config/pi-sdk-contract.cjs";
import { verifyPiLocalSearch } from "./pi-feature-runtime-smoke.mjs";

const providers = ["anthropic", "google", "openai"];

test("Pi runtimeを移動しても公開API・選択provider・Extensions・資産が動作する", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "nerita-pi-bundle-"));
	t.after(async () => {
		assert.equal(path.dirname(root), tmpdir());
		assert.ok(path.basename(root).startsWith("nerita-pi-bundle-"));
		await rm(root, { recursive: true, force: true });
	});
	const target = path.join(root, "配布先 with spaces #");
	await packaging.bundlePi(repoRoot, target);
	const sdk = await import(pathToFileURL(path.join(target, "pi.mjs")).href);
	const runtime = await sdk.ModelRuntime.create({
		authPath: path.join(root, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});

	await t.test(
		"配布プロバイダーのモデル候補・推論・画像対応を取得できる",
		() => {
			assert.deepEqual(
				runtime
					.getProviders()
					.map((provider) => provider.id)
					.sort(),
				providers,
			);
			for (const provider of providers) {
				const models = runtime.getModels(provider);
				assert.ok(models.length > 0);
				assert.ok(models.some((model) => model.reasoning));
				assert.ok(
					models.some((model) => model.input.includes("image")),
				);
			}
		},
	);

	await t.test("OAuth flowの変数importを配布chunkへ接続する", async () => {
		for (const id of ["openai", "anthropic"]) {
			const oauth = runtime.getProvider(id).auth.oauth;
			assert.deepEqual(
				await oauth.toAuth({
					type: "oauth",
					access: "isolated-test-token",
					refresh: "unused",
					expires: Date.now() + 3600000,
				}),
				{ apiKey: "isolated-test-token" },
			);
		}
	});

	await t.test(
		"新 OAuth の device ID・issued client ID・保存と更新を配布物だけで扱う",
		async () => {
			const oauth = runtime.getProvider("openai").auth.oauth;
			const fetch = globalThis.fetch;
			const bodies = [];
			let authorization;
			globalThis.fetch = async (url, init) => {
				assert.equal(
					String(url),
					"https://auth.openai.com/api/accounts/oauth/token",
				);
				bodies.push(Object.fromEntries(init.body));
				return Response.json({
					access_token: "packaged-new-access",
					refresh_token: "packaged-new-refresh",
					id_token: "test-id-token",
					scope: "chatgpt.tokens.use.direct",
					expires_in: 3600,
				});
			};
			try {
				const credential = await runtime.login(
					"openai",
					"oauth",
					{
						notify(event) {
							if (event.type === "auth_url") {
								authorization = new URL(event.url);
							}
						},
						async prompt() {
							assert.equal(
								authorization.searchParams.get(
									"ext_agent_host_id",
								),
								"urn:uuid:82a004aa-2fdd-4175-b108-a351540c19ca",
							);
							const callback = new URL(
								authorization.searchParams.get("redirect_uri"),
							);
							callback.search = new URLSearchParams({
								code: "test-code",
								client_id: "issued-test-client",
								state: authorization.searchParams.get("state"),
							}).toString();
							return callback.href;
						},
					},
					{
						getDeviceId: () =>
							"82a004aa-2fdd-4175-b108-a351540c19ca",
					},
				);
				assert.equal(credential.clientId, "issued-test-client");
				assert.equal(bodies[0].resource, "https://api.openai.com/v1");
				assert.equal(bodies[0].client_id, "issued-test-client");
				const stored = JSON.parse(
					await readFile(path.join(root, "auth.json"), "utf8"),
				);
				assert.equal(stored.openai.clientId, "issued-test-client");
				assert.equal(stored["openai-codex"], undefined);
				await oauth.refresh(credential, new AbortController().signal);
				assert.equal(bodies[1].grant_type, "refresh_token");
				assert.equal(bodies[1].client_id, "issued-test-client");
				await assert.rejects(
					oauth.login({
						signal: AbortSignal.abort(),
						notify() {},
						async prompt() {
							throw new Error("unexpected");
						},
					}),
					/device ID/,
				);
			} finally {
				globalThis.fetch = fetch;
			}
		},
	);

	await t.test(
		"新 OAuth のローカル検索を function と additional_tools で送る",
		() => verifyPiLocalSearch(sdk, root),
	);

	await t.test(
		"models.jsonの任意baseUrlと汎用adapterを維持する",
		async () => {
			const modelsPath = path.join(root, "models.json");
			await writeFile(
				modelsPath,
				JSON.stringify({
					providers: {
						local: {
							api: "openai-completions",
							baseUrl: "http://localhost:11434/v1",
							apiKey: "local",
							models: [
								{
									id: "local-model",
									reasoning: false,
									input: ["text"],
								},
							],
						},
						custom: {
							api: "openai-responses",
							baseUrl: "https://models.example.invalid/v1",
							apiKey: "custom",
							models: [
								{
									id: "custom-model",
									reasoning: true,
									input: ["text", "image"],
								},
							],
						},
					},
				}),
			);
			const models = await sdk.ModelRuntime.create({
				authPath: path.join(root, "custom-auth.json"),
				modelsPath,
			});
			assert.equal(
				models.getModel("local", "local-model").api,
				"openai-completions",
			);
			assert.equal(
				models.getModel("local", "local-model").baseUrl,
				"http://localhost:11434/v1",
			);
			assert.equal(
				models.getModel("custom", "custom-model").api,
				"openai-responses",
			);
			assert.equal(models.getError(), undefined);
		},
	);

	await t.test(
		"TypeScript ExtensionのSDK・TypeBox importと相対資産を解決する",
		async () => {
			const cwd = path.join(root, "workspace");
			const agentDir = path.join(root, "agent");
			const extensions = path.join(cwd, ".pi/extensions");
			await mkdir(extensions, { recursive: true });
			await mkdir(agentDir);
			await writeFile(
				path.join(extensions, "test.ts"),
				`
import { defineTool, getPackageDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export default function(pi: any) {
  const metadata = JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8"));
  if (metadata.name !== "@earendil-works/pi-coding-agent") throw new Error("package metadata missing");
  pi.registerTool(defineTool({ name: "packaged_tool", label: "Packaged", description: "test", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "ok" }] }; } }));
}
`,
			);
			const loader = new sdk.DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: sdk.SettingsManager.inMemory(),
				noSkills: true,
				noPromptTemplates: true,
			});
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			const tool = loader
				.getExtensions()
				.extensions.flatMap((extension) => [
					...extension.tools.values(),
				])
				.find((entry) => entry.definition.name === "packaged_tool");
			assert.ok(tool, "配布先で Extension のツールを読み込めません");
			const result = await tool.definition.execute(
				"fixture",
				{},
				new AbortController().signal,
			);
			assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);
			assert.equal(sdk.getPackageDir(), path.join(target, "pi"));
			assert.ok(
				(
					await readdir(
						path.join(target, "pi/dist/modes/interactive/theme"),
					)
				).includes("dark.json"),
			);
		},
	);

	await t.test("SDK内部参照の変更をビルド前に検出する", async () => {
		const changed = path.join(root, "changed-sdk");
		await mkdir(path.join(changed, "dist"), { recursive: true });
		await writeFile(
			path.join(changed, "dist/index.js"),
			"export const changed = true;",
		);
		await assert.rejects(
			contract.verifyPiSources({ sdk: changed, ai: changed }),
			/bundle契約が変更/,
		);
	});

	await t.test(
		"MCPの接続・動的定義・構造化結果を配布アダプターで扱う",
		async () => {
			const adapter = await sdk.loadPiMcp();
			const server = createServer(async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405).end();
					return;
				}
				const chunks = [];
				for await (const chunk of request) {
					chunks.push(chunk);
				}
				const message = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				);
				if (message.id === undefined) {
					response.writeHead(204).end();
					return;
				}
				let result;
				switch (message.method) {
					case "initialize":
						result = {
							protocolVersion: "2025-11-25",
							capabilities: { tools: {} },
							serverInfo: { name: "test", version: "1" },
						};
						break;
					case "tools/list":
						result = {
							tools: [
								{
									name: "count",
									description: "Count items",
									inputSchema: {
										type: "object",
										properties: {},
									},
								},
							],
						};
						break;
					default:
						result = {
							content: [],
							structuredContent: { count: 3 },
							_meta: { private: "never-show" },
						};
				}
				response
					.writeHead(200, { "Content-Type": "application/json" })
					.end(
						JSON.stringify({
							jsonrpc: "2.0",
							id: message.id,
							result,
						}),
					);
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			const config = adapter.validateMcpServerConfig("test", {
				url: `http://127.0.0.1:${server.address().port}/mcp`,
				headers: { Authorization: "Bearer fixture" },
				exposure: "deferred",
			});
			assert.notEqual(typeof config, "string");
			let registrations = 0;
			const connection = new adapter.McpServerConnection({
				entry: {
					name: "test",
					config,
					source: "fixture",
					scope: "extension",
				},
				cwd: root,
				credentials: {
					forServer() {
						throw new Error("OAuth must remain inactive");
					},
				},
				createTransport: (entry) =>
					new adapter.StreamableHttpTransport({
						url: entry.config.url,
						headers: entry.config.headers,
						openGetStream: false,
					}),
				onTools: () => {
					registrations++;
				},
			});
			try {
				await connection.getClient();
				assert.equal(connection.state, "connected");
				assert.ok(registrations > 0);
				const definition = adapter.createMcpToolDefinition({
					server: "test",
					tool: connection.tools[0],
					name: "mcp__test__count",
					exposure: "deferred",
					namespace: { name: "mcp__test", description: "fixture" },
					timeoutMs: 1000,
					getClient: async () => connection,
				});
				const result = await definition.execute(
					"count",
					{},
					new AbortController().signal,
				);
				assert.deepEqual(result.structuredContent.structuredContent, {
					count: 3,
				});
				assert.equal(result.structuredContent._meta, undefined);
			} finally {
				await connection.close();
				await new Promise((resolve) => server.close(resolve));
			}
		},
	);

	await t.test(
		"QuickJSのWASM・worker・実行と停止を配布物だけで扱う",
		async () => {
			let tool;
			const writes = [];
			sdk.createCodemodeExtension({ models: false })({
				registerTool(value) {
					tool = value;
				},
				appendEntry(...args) {
					writes.push(args);
				},
				getAllTools: () => [],
				getSettings: () => ({}),
			});
			const context = {
				tools: [],
				sessionManager: { getBranch: () => [] },
			};
			const result = await tool.execute(
				"script",
				{
					code: '// @options: {"timeout_ms": 3000}\ntext({ count: 3 }); text(typeof process); text(typeof fetch); text(typeof models);',
				},
				new AbortController().signal,
				undefined,
				context,
			);
			const text = result.content.map((part) => part.text).join("\n");
			assert.notEqual(result.isError, true);
			assert.deepEqual(
				JSON.parse(
					text.split("\n").find((line) => line.startsWith("{")),
				),
				{ count: 3 },
			);
			assert.equal(text.split("undefined").length - 1, 3);
			assert.deepEqual(writes, []);
			const controller = new AbortController();
			const running = tool.execute(
				"stop",
				{ code: '// @options: {"timeout_ms": 3000}\nwhile (true) {}' },
				controller.signal,
				undefined,
				context,
			);
			setTimeout(() => controller.abort(), 100);
			const stopped = await running;
			assert.equal(stopped.isError, true);
			assert.match(
				stopped.content.map((part) => part.text).join("\n"),
				/Script aborted:/,
			);
		},
	);

	await t.test("画像WASMとworkerを配布物だけで実行する", async () => {
		const png = await sdk.convertToPng(
			"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
			"image/gif",
		);
		assert.ok(png);
		const bytes = new Uint8Array(Buffer.from(png.data, "base64"));
		const worker = new Worker(
			pathToFileURL(path.join(target, "pi/image-resize-worker.mjs")),
		);
		try {
			const response = once(worker, "message");
			worker.postMessage({ inputBytes: bytes, mimeType: "image/png" });
			const [message] = await response;
			assert.equal(message.error, undefined);
			assert.equal(message.result.width, 1);
		} finally {
			await worker.terminate();
		}
		assert.equal((await sdk.resizeImage(bytes, "image/png")).width, 1);
	});
});

test("SDKの参照面が変わった場合は互換変換を黙って省略しない", () => {
	assert.throws(
		() =>
			plugin.replaceRequired(
				"changed SDK",
				"old reference",
				"new reference",
			),
		/互換処理を再確認/,
	);
});
