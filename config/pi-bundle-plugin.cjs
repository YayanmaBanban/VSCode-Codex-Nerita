// 固定 SDK のカタログ・互換 API・動的参照を配布用に限定する。上流ファイルは変更しない。
const fs = require("node:fs/promises");
const path = require("node:path");

const supportedApis = new Set([
	"anthropic-messages",
	"google-generative-ai",
	"openai-completions",
	"openai-responses",
]);

/** SDK 更新時に置換の無効化を見逃さず、ビルドを停止する。 */
function replaceRequired(source, before, after) {
	if (!source.includes(before)) {
		throw new Error(`Pi bundleの互換処理を再確認してください: ${before}`);
	}
	return source.replace(before, after);
}

/** 上流と同じ同期カタログ API を、選択した3プロバイダーのメタデータから構成する。 */
function providerCatalog() {
	return `
import { createModels } from "../models.js";
import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import { googleProvider } from "./google.js";
import manifest from "./data/.manifest.json" with { type: "json" };
export { openaiProvider, anthropicProvider, googleProvider };
export function builtinProviders() { return [openaiProvider(), anthropicProvider(), googleProvider()]; }
const catalog = new Map(builtinProviders().map(p => [p.id, p.getModels()]));
export function getBuiltinModelDataGeneratedAt() { const value = Date.parse(manifest.generatedAt); return Number.isNaN(value) ? undefined : value; }
export function getBuiltinProviders() { return [...catalog.keys()]; }
export function getBuiltinModels(provider) { return catalog.get(provider) ?? []; }
export function getBuiltinModel(provider, id) { return getBuiltinModels(provider).find(m => m.id === id); }
export function builtinModels(options) { const models = createModels(options); for (const provider of builtinProviders()) models.setProvider(provider); return models; }
export function radiusProvider() { throw new Error("Neritaの同梱Pi runtimeはRadius OAuthに対応していません。custom providerのAPI設定を使用してください。"); }
`;
}

/** 互換層の API 登録と呼び出し先の選択処理を維持し、未使用 API と画像生成の公開を除く。 */
function limitCompat(source) {
	return source
		.split("\n")
		.filter((line) => {
			const api = line.match(/\.\/api\/([\w-]+)\.lazy\.js/);
			if (api && !supportedApis.has(api[1])) {
				return false;
			}
			const registration = line.match(/^\s*\["([\w-]+)", \w+Api\(\)\],$/);
			if (registration && !supportedApis.has(registration[1])) {
				return false;
			}
			return !/^export \* from "\.\/(?:image-models|images|images-api-registry|providers\/images\/register-builtins)\.js";/.test(
				line,
			);
		})
		.join("\n");
}

/** MCP の再送と OAuth 更新を、固定 SDK の Host 境界へ接続する。 */
async function mcpHostContents(file, sdkFile) {
	let contents = await fs.readFile(file, "utf8");
	if (sdkFile === "dist/extensions/mcp/runtime.js") {
		contents = replaceRequired(
			contents,
			"if (error instanceof McpSessionExpiredError && attempt === 1)",
			"if (readOnly && error instanceof McpSessionExpiredError && attempt === 1)",
		);
		contents = replaceRequired(
			contents,
			"serverUrl: url,",
			"serverUrl: url, fetch: options.oauthFetch,",
		);
	} else if (sdkFile === "dist/extensions/mcp/oauth.js") {
		contents = replaceRequired(
			contents,
			"fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS) }),",
			"fetch: (input, init) => (options.fetch ?? fetch)(input, { ...init, signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS) }),",
		);
	}
	return contents;
}

/** バンドルで追跡できない参照だけを固定 SDK に対する小さな変換で補う。 */
function piBundlePlugin(sdkRoot, aiRoot) {
	return {
		name: "nerita-pi-runtime",
		setup(build) {
			build.onLoad({ filter: /\.js$/ }, async (args) => {
				const sdkFile = path
					.relative(sdkRoot, args.path)
					.replaceAll("\\", "/");
				const aiFile = path
					.relative(aiRoot, args.path)
					.replaceAll("\\", "/");
				const codemodeLimits = require("./pi-codemode-limits.cjs");
				let contents = await codemodeLimits.codemodeContents(
					args.path,
					sdkFile,
					aiFile,
				);
				if (aiFile === "dist/providers/all.js") {
					contents = providerCatalog();
				} else if (aiFile === "dist/compat.js") {
					contents = limitCompat(
						await fs.readFile(args.path, "utf8"),
					);
				} else if (aiFile === "dist/legacy-api-aliases.js") {
					// 対象 API の旧 `stream` 名はユーザー Extension 向けに維持する。
					contents = (await fs.readFile(args.path, "utf8"))
						.split("\n")
						.filter(
							(line) =>
								!/azureOpenAIResponses|googleVertex|mistralConversations|openAICodex|OpenAICodex|openai-codex/.test(
									line,
								),
						)
						.join("\n");
				} else if (aiFile === "dist/auth/oauth/load.js") {
					// OAuth の認証処理も ESM チャンクへ分離する。変数を使うインポートを固定パスに変え、ビルド時の追跡漏れを防ぐ。
					contents = `export const loadAnthropicOAuth = async () => (await import("./anthropic.js")).anthropicOAuth;
export const loadOpenAIChatGPTOAuth = async () => (await import("./openai-chatgpt.js")).openaiChatGPTOAuth;`;
				} else if (sdkFile === "dist/index.js") {
					// `Extensions` 用名前空間から CLI 起動・対話モードを到達不能にする。
					contents = (await fs.readFile(args.path, "utf8"))
						.split("\n")
						.filter(
							(line) =>
								!/^export .* from "\.\/(?:main|cli\/args|modes\/index)\.js";/.test(
									line,
								),
						)
						.join("\n");
				} else if (sdkFile.startsWith("dist/extensions/mcp/")) {
					contents = await mcpHostContents(args.path, sdkFile);
				} else if (sdkFile === "dist/config.js") {
					contents = replaceRequired(
						await fs.readFile(args.path, "utf8"),
						'createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm")',
						'fileURLToPath(new URL("./quickjs.wasm", import.meta.url))',
					);
					contents = replaceRequired(
						contents,
						'"./codemode-worker.js"',
						'"./codemode-worker.mjs"',
					);
				} else if (sdkFile === "dist/utils/image-resize.js") {
					contents = replaceRequired(
						await fs.readFile(args.path, "utf8"),
						'"./image-resize-worker.js"',
						'"./image-resize-worker.mjs"',
					);
				}
				return contents === undefined
					? undefined
					: { contents, loader: "js" };
			});
		},
	};
}
module.exports = { piBundlePlugin, supportedApis, replaceRequired };
