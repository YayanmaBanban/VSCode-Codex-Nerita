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
import { privatePiMessage } from "./PiMessageSafety";
import type { PiReferenceHistory } from "./PiReferenceHistory";
import type { PiSubagentDefinition } from "./PiSubagentDefinitions";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

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
	referenceHistory?: PiReferenceHistory,
	agentDefinitions?: () => Promise<PiSubagentDefinition[]>,
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
			referenceHistory,
			agentDefinitions,
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
			// 外部拡張の本文を保護してから、直後に保存される本文の参照情報を追加する。
			result.extensions.sort(
				(a, b) =>
					extensionTailOrder(a.path) - extensionTailOrder(b.path),
			);
			return result;
		},
	});
	await loader.reload();
	signal.throwIfAborted();
	const errors = loader.getExtensions().errors;
	if (errors.length > 0) {
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
	referenceHistory: PiReferenceHistory | undefined,
	agentDefinitions: (() => Promise<PiSubagentDefinition[]>) | undefined,
): PiSdk.InlineExtension[] {
	return [
		...(agentDefinitions ? [agentSettingsExtension(agentDefinitions)] : []),
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
					message: features.protect
						? privatePiMessage(event.message, features.protect)
						: event.message,
				}));
			},
		},
		...(referenceHistory ? [referenceHistory.extension()] : []),
	];
}

/** 本文を書き換える外部拡張、秘密値保護、参照保存の順序を維持する。 */
function extensionTailOrder(path: string): number {
	return [
		"<inline:nerita-secret-protection>",
		"<inline:nerita-reference-history>",
	].indexOf(path);
}

/** 各ターンの指示へ最新の利用可能な定義を追加する。コードの再読込みは行わない。 */
function agentSettingsExtension(
	read: () => Promise<PiSubagentDefinition[]>,
): PiSdk.InlineExtension {
	return {
		name: "nerita-agent-settings",
		hidden: true,
		factory(api) {
			api.on("before_agent_start", async (event) => {
				const definitions = await read();
				const agents = definitions
					.filter(
						(definition) =>
							!isNonEmptyString(definition.unavailableReason),
					)
					.map((definition) => ({
						name: definition.name,
						description: definition.description,
						aliases: definition.aliases ?? [],
					}));
				return {
					systemPrompt: `${event.systemPrompt}\nAvailable Nerita subagents (latest saved settings): ${JSON.stringify(agents)}`,
				};
			});
		},
	};
}
