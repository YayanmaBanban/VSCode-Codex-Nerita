// 開発ツリー外の実バンドルで、provider・動的読込・相対資産の配布契約を検証する。
import assert from "node:assert/strict";
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
import { isBuiltin } from "node:module";
import { once } from "node:events";
import { test } from "node:test";
import packaging from "../config/package-pi.cjs";
import plugin from "../config/pi-bundle-plugin.cjs";
import contract from "../config/pi-sdk-contract.cjs";

const providers = ["anthropic", "google", "openai-codex"];

test("Pi runtimeを移動しても公開API・選択provider・Extensions・資産が動作する", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "nerita-pi-bundle-"));
	t.after(async () => {
		assert.equal(path.dirname(root), tmpdir());
		assert.ok(path.basename(root).startsWith("nerita-pi-bundle-"));
		await rm(root, { recursive: true, force: true });
	});
	const target = path.join(root, "配布先 with spaces #");
	const metadata = await packaging.bundlePi(process.cwd(), target);
	const sdk = await import(pathToFileURL(path.join(target, "pi.mjs")).href);
	const runtime = await sdk.ModelRuntime.create({
		authPath: path.join(root, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});

	await t.test("Host公開APIと3providerのモデルmetadataを維持する", () => {
		assert.deepEqual(
			Object.keys(sdk).sort(),
			[
				"createAgentSession",
				"ModelRuntime",
				"SessionManager",
				"SettingsManager",
				"DefaultResourceLoader",
				"DefaultPackageManager",
				"getAgentDir",
				"getPackageDir",
				"parseSessionEntries",
				"createWriteToolDefinition",
				"createEditToolDefinition",
				"createPowerShellToolDefinition",
				"createBashToolDefinition",
				"convertToPng",
				"resizeImage",
			].sort(),
		);
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
			assert.ok(models.some((model) => model.input.includes("image")));
		}
	});

	await t.test(
		"3providerと汎用APIの実装が独立した遅延chunkとして解決する",
		async () => {
			const inputs = Object.keys(metadata.inputs);
			const catalogs = inputs.filter((file) =>
				/pi-ai\/dist\/providers\/data\/[^/.]+\.json$/.test(file),
			);
			assert.deepEqual(
				catalogs.map((file) => path.basename(file, ".json")).sort(),
				providers,
			);
			assert.equal(
				inputs.some((file) =>
					/(?:@aws-sdk|@smithy|models\.generated|bedrock-converse|google-vertex|mistral-conversations)/.test(
						file,
					),
				),
				false,
			);
			const chunks = new Set();
			for (const api of plugin.supportedApis) {
				const entry = Object.entries(metadata.outputs).find(
					([, output]) =>
						output.entryPoint?.endsWith(`/api/${api}.js`),
				);
				assert.ok(entry, `${api}の遅延chunkがありません`);
				chunks.add(entry[0]);
				const loaded = await import(
					pathToFileURL(path.resolve(entry[0])).href
				);
				assert.equal(typeof loaded.streamSimple, "function");
			}
			assert.equal(chunks.size, 5);
			for (const output of Object.values(metadata.outputs)) {
				for (const imported of output.imports ?? []) {
					if (imported.external) {
						// `ws` の任意ネイティブ実装による高速化は未同梱でも JS 実装へフォールバックする。
						assert.ok(
							isBuiltin(imported.path) ||
								[
									"@silvia-odwyer/photon-node",
									"bufferutil",
									"utf-8-validate",
								].includes(imported.path),
							imported.path,
						);
					}
				}
			}
			await assert.rejects(
				readFile(
					path.join(
						target,
						"node_modules/@earendil-works/pi-coding-agent/package.json",
					),
				),
				{ code: "ENOENT" },
			);
		},
	);

	await t.test("OAuth flowの変数importを配布chunkへ接続する", async () => {
		for (const id of ["openai-codex", "anthropic"]) {
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
import { getProviders, streamSimpleAnthropic, streamSimpleGoogle, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export default function(pi: any) {
  const metadata = JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8"));
  if (metadata.version !== "${packaging.SUPPORTED_PI_VERSION}") throw new Error("package metadata missing");
  if (getProviders().sort().join(",") !== "${providers.join(",")}") throw new Error("provider catalog mismatch");
  if (![streamSimpleAnthropic, streamSimpleGoogle, streamSimpleOpenAICompletions].every(fn => typeof fn === "function")) throw new Error("compat aliases missing");
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
			assert.ok(
				loader
					.getExtensions()
					.extensions.some((extension) =>
						extension.tools.has("packaged_tool"),
					),
			);
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
