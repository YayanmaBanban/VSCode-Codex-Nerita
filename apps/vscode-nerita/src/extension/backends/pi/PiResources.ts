// Pi 標準のパッケージ解決を利用し、登録ツールを Host の承認へ接続する。

import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { type PiAuthorize } from "./PiApprovedTools";
import { neritaExtensionFactories } from "./PiBuiltinExtensions";
import type { PiProviderControls } from "./PiProviderControls";
import { localResourceSettings } from "./PiResourceSettings";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import type { PiWebTrust } from "./PiWebTrust";
import type { PiToolFeatures } from "./PiToolFeatures";
import { guardPiExtensionTools } from "./PiExtensionTools";
import { neritaMcpExtension } from "./mcp/PiMcpExtension";
import type { PiMcpSdk } from "./mcp/PiMcpSdk";

/** 本文をファイルパスと解釈させず、定義の指定どおり基底プロンプトへ反映する。 */
function agentPromptOverride(
	prompt: string | undefined,
	mode: "append" | "replace",
) {
	if (prompt === undefined) {
		return {};
	}
	if (mode === "replace") {
		return { systemPromptOverride: () => prompt };
	}
	return {
		appendSystemPromptOverride: (base: string[]) => [...base, prompt],
	};
}

/** CLI で導入したリソースを新規会話・再接続時に読み込む。 */
export async function loadPiResources(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	settingsManager: PiSdk.SettingsManager,
	authorize: PiAuthorize,
	signal: AbortSignal,
	controls?: PiProviderControls,
	trustedExtensionPaths: string[] = [],
	policy?: AgentAccessPolicy,
	appendPrompt?: string,
	promptMode: "append" | "replace" = "append",
	webTrust: PiWebTrust[] = [],
	features: PiToolFeatures = {},
): Promise<PiSdk.DefaultResourceLoader> {
	const mcpSdk = sdk as typeof PiSdk & {
		loadPiMcp?: () => Promise<PiMcpSdk>;
	};
	const loader = new sdk.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: await localResourceSettings(
			sdk,
			cwd,
			agentDir,
			settingsManager,
		),
		// SDK が自動発見したコードはロードせず、明示的に信頼した各拡張の単一のエントリーポイントと組み込み拡張を使う。
		noExtensions: true,
		additionalExtensionPaths: trustedExtensionPaths,
		extensionFactories: resourceExtensionFactories(
			controls,
			sdk,
			features,
			cwd,
			authorize,
			signal,
			policy,
			mcpSdk,
			agentDir,
			settingsManager,
			trustedExtensionPaths,
		),
		// ターミナル用のテーマは VS Code Webview には適用しない。
		noThemes: true,
		...agentPromptOverride(appendPrompt, promptMode),
		extensionsOverride(result) {
			for (const extension of result.extensions) {
				guardPiExtensionTools(
					extension,
					cwd,
					authorize,
					policy,
					signal,
					features,
					webTrust,
				);
			}
			// 外部拡張が確定メッセージを変更した場合も、公開・保存直前の最後のハンドラーで保護する。
			result.extensions.sort(
				(a, b) =>
					Number(a.path === "<inline:nerita-secret-protection>") -
					Number(b.path === "<inline:nerita-secret-protection>"),
			);
			return result;
		},
	});
	await loader.reload();
	signal.throwIfAborted();
	const errors = loader.getExtensions().errors;
	if (errors.length) {
		throw new Error(
			`Pi拡張を読み込めませんでした: ${errors.map((item) => `${item.path}: ${item.error}`).join(", ")}`,
		);
	}
	return loader;
}

/** 承認と寿命を接続した組込み拡張のファクトリーを構成する。 */
function resourceExtensionFactories(
	controls: PiProviderControls | undefined,
	sdk: typeof PiSdk,
	features: PiToolFeatures,
	cwd: string,
	authorize: PiAuthorize,
	signal: AbortSignal,
	policy: AgentAccessPolicy | undefined,
	mcpSdk: typeof PiSdk & { loadPiMcp?: () => Promise<PiMcpSdk> },
	agentDir: string,
	settingsManager: PiSdk.SettingsManager,
	trustedExtensionPaths: string[],
): PiSdk.InlineExtension[] {
	return [
		...neritaExtensionFactories(controls, {
			sdk,
			features,
			cwd,
			authorize,
			signal,
			...(policy ? { policy } : {}),
		}),
		...(mcpSdk.loadPiMcp && policy
			? [
					{
						name: "nerita-mcp",
						factory: neritaMcpExtension({
							load: mcpSdk.loadPiMcp,
							cwd,
							agentDir,
							policy,
							authorize,
							signal,
							features,
							projectTrusted: () =>
								settingsManager.isProjectTrusted(),
							trustedExtensionPaths,
						}),
					},
				]
			: []),
		{
			name: "nerita-secret-protection",
			hidden: true,
			factory(api) {
				api.on("message_end", (event) => ({
					message: features.protect?.(event.message) ?? event.message,
				}));
			},
		},
	];
}
