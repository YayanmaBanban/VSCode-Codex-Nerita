// 固定SDKのcatalog・互換API・動的参照を配布用に限定する。上流ファイルは変更しない。
const fs = require("node:fs/promises");
const path = require("node:path");

const supportedApis = new Set([
	"anthropic-messages",
	"google-generative-ai",
	"openai-codex-responses",
	"openai-completions",
	"openai-responses",
]);

/** SDK更新時に置換の無効化を見逃さず、ビルドを停止する。 */
function replaceRequired(source, before, after) {
	if (!source.includes(before)) {
		throw new Error(`Pi bundleの互換処理を再確認してください: ${before}`);
	}
	return source.replace(before, after);
}

/** 上流と同じ同期catalog APIを、選択した3providerのmetadataから構成する。 */
function providerCatalog() {
	return `
import { createModels } from "../models.js";
import { openaiCodexProvider } from "./openai-codex.js";
import { anthropicProvider } from "./anthropic.js";
import { googleProvider } from "./google.js";
import manifest from "./data/.manifest.json" with { type: "json" };
export { openaiCodexProvider, anthropicProvider, googleProvider };
export function builtinProviders() { return [openaiCodexProvider(), anthropicProvider(), googleProvider()]; }
const catalog = new Map(builtinProviders().map(p => [p.id, p.getModels()]));
export function getBuiltinModelDataGeneratedAt() { const value = Date.parse(manifest.generatedAt); return Number.isNaN(value) ? undefined : value; }
export function getBuiltinProviders() { return [...catalog.keys()]; }
export function getBuiltinModels(provider) { return catalog.get(provider) ?? []; }
export function getBuiltinModel(provider, id) { return getBuiltinModels(provider).find(m => m.id === id); }
export function builtinModels(options) { const models = createModels(options); for (const provider of builtinProviders()) models.setProvider(provider); return models; }
export function radiusProvider() { throw new Error("Neritaの同梱Pi runtimeはRadius OAuthに対応していません。custom providerのAPI設定を使用してください。"); }
`;
}

/** 互換層の登録・dispatch処理を維持し、未使用APIと画像生成だけを除く。 */
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

/** bundleで追跡できない参照だけを固定SDKに対する小さな変換で補う。 */
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
				let contents;
				if (aiFile === "dist/providers/all.js") {
					contents = providerCatalog();
				} else if (aiFile === "dist/compat.js") {
					contents = limitCompat(
						await fs.readFile(args.path, "utf8"),
					);
				} else if (aiFile === "dist/legacy-api-aliases.js") {
					// 対象APIの旧stream名はユーザーExtension向けに維持する。
					contents = (await fs.readFile(args.path, "utf8"))
						.split("\n")
						.filter(
							(line) =>
								!/azureOpenAIResponses|googleVertex|mistralConversations/.test(
									line,
								),
						)
						.join("\n");
				} else if (aiFile === "dist/auth/oauth/load.js") {
					// OAuth flowもESM chunkへ分離し、変数importの解決漏れを防ぐ。
					contents = `export const loadAnthropicOAuth = async () => (await import("./anthropic.js")).anthropicOAuth;
export const loadOpenAICodexOAuth = async () => (await import("./openai-codex.js")).openaiCodexOAuth;`;
				} else if (sdkFile === "dist/index.js") {
					// Extensions用namespaceからCLI起動・対話モードを到達不能にする。
					contents = (await fs.readFile(args.path, "utf8"))
						.split("\n")
						.filter(
							(line) =>
								!/^export .* from "\.\/(?:main|cli\/args|modes\/index)\.js";/.test(
									line,
								),
						)
						.join("\n");
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
