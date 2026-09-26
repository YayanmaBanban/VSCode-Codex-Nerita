// Pi 標準のパッケージ解決を利用し、登録ツールを Host の承認へ接続する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { approvePiTool, type PiAuthorize } from "./PiApprovedTools";
import { neritaExtensionFactories } from "./PiBuiltinExtensions";
import type { PiProviderControls } from "./PiProviderControls";
import { localResourceSettings } from "./PiResourceSettings";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { createPiHostShellTool } from "./PiHostShellTool";

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
): Promise<PiSdk.DefaultResourceLoader> {
	const loader = new sdk.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: await localResourceSettings(
			sdk,
			cwd,
			agentDir,
			settingsManager,
		),
		// SDK の自動発見したコードはロードせず、明示 Trust を通った単一 `entry` と `builtin` を使う。
		noExtensions: true,
		additionalExtensionPaths: trustedExtensionPaths,
		extensionFactories: neritaExtensionFactories(controls),
		// ターミナル用のテーマは VS Code Webview には適用しない。
		noThemes: true,
		...agentPromptOverride(appendPrompt, promptMode),
		extensionsOverride(result) {
			for (const extension of result.extensions) {
				for (const [name, tool] of extension.tools) {
					if (
						process.platform !== "win32" &&
						name === "bash" &&
						policy
					) {
						extension.tools.set(name, {
							...tool,
							definition: createPiHostShellTool(
								tool.definition,
								cwd,
								authorize,
								policy,
								signal,
							),
						});
						continue;
					}
					if (
						[
							"read",
							"ls",
							"write",
							"edit",
							"powershell",
							"pwsh",
							"bash",
							"grep",
							"find",
							"subagent",
						].includes(name)
					) {
						throw new Error(
							`Pi拡張による組み込みToolの上書きは拒否されました: ${name}`,
						);
					}
					extension.tools.set(name, {
						...tool,
						definition: approvePiTool(
							tool.definition,
							cwd,
							authorize,
							policy,
							signal,
						),
					});
				}
			}
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
