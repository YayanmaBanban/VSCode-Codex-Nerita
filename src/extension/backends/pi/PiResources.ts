// 固定builtinだけをロードし、モデル用コンテキストの読込みをHostの境界へ接続する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { approvePiTool, type PiAuthorize } from "./PiApprovedTools";
import { neritaExtensionFactories } from "./PiBuiltinExtensions";
import type { PiProviderControls } from "./PiProviderControls";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { resolveTrustedPiExtensions } from "./PiExtensionTrust";
import { localResourceSettings } from "./PiResourceSettings";
import { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { loadPiContextFiles, type PiContextFiles } from "./PiContextFiles";

/** 起動・reloadともSDKの直接読込みを無効にしてから本文を提供する。 */
export async function loadPiResources(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	settingsManager: PiSdk.SettingsManager,
	authorize: PiAuthorize,
	signal: AbortSignal,
	policy: AgentAccessPolicy,
	trustedExtensionPaths: readonly string[],
	controls?: PiProviderControls,
): Promise<PiSdk.DefaultResourceLoader> {
	const trustedPaths = await resolveTrustedPiExtensions(
		trustedExtensionPaths,
	);
	signal.throwIfAborted();
	const resourceSettings = await localResourceSettings(
		sdk,
		cwd,
		agentDir,
		settingsManager,
	);
	/** reload時にもbrokerを使い、読み込んだ本文をSDKにパスとして再解釈させない。 */
	class PolicyResourceLoader extends sdk.DefaultResourceLoader {
		private contextFiles: PiContextFiles = {
			agentsFiles: [],
			system: undefined,
			append: undefined,
		};
		/** 更新失敗時には以前の本文にも戻さない。 */
		override async reload(
			options?: Parameters<PiSdk.DefaultResourceLoader["reload"]>[0],
		) {
			this.contextFiles = {
				agentsFiles: [],
				system: undefined,
				append: undefined,
			};
			const files = await loadPiContextFiles(
				new WorkspacePathPolicy(policy, cwd),
				signal,
			);
			await super.reload(options);
			signal.throwIfAborted();
			this.contextFiles = files;
		}
		/** brokerが返した指示ファイルだけをコンテキストへ渡す。 */
		override getAgentsFiles() {
			return { agentsFiles: this.contextFiles.agentsFiles };
		}
		/** 本文をファイルパスとしてSDKへ再入力しない。 */
		override getSystemPrompt() {
			return this.contextFiles.system?.content;
		}
		/** 検査済みの出典を返す。 */
		override getSystemPromptSource() {
			return this.contextFiles.system
				? { path: this.contextFiles.system.path }
				: undefined;
		}
		/** 追加本文もbrokerで検査したsnapshotに限定する。 */
		override getAppendSystemPrompt() {
			return this.contextFiles.append
				? [this.contextFiles.append.content]
				: [];
		}
		/** 追加本文の出典を返す。 */
		override getAppendSystemPromptSources() {
			return this.contextFiles.append
				? [{ path: this.contextFiles.append.path }]
				: [];
		}
	}
	const loader = new PolicyResourceLoader({
		cwd,
		agentDir,
		settingsManager: resourceSettings,
		extensionFactories: neritaExtensionFactories(controls),
		// 外部JavaScriptはツール承認を迂回できるため、固定builtin以外をロードしない。
		noExtensions: true,
		additionalExtensionPaths: trustedPaths,
		// ターミナル用のテーマはVS Code Webviewには適用しない。
		noThemes: true,
		// overrideだけでは読込み後になってしまうため、SDKの探索自体を停止する。
		noContextFiles: true,
		systemPrompt: "",
		appendSystemPrompt: [],
		noSkills: true,
		noPromptTemplates: true,
		extensionsOverride(result) {
			for (const extension of result.extensions) {
				for (const [name, tool] of extension.tools) {
					if (
						[
							"read",
							"ls",
							"grep",
							"find",
							"write",
							"edit",
							"powershell",
							"bash",
						].includes(name)
					) {
						throw new Error(
							`Pi拡張は組み込みツールを上書きできません: ${name}`,
						);
					}
					extension.tools.set(name, {
						...tool,
						definition: approvePiTool(
							tool.definition,
							cwd,
							authorize,
							policy,
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
			`Pi拡張を読み込めませんでした: ${errors.map((item) => item.path).join(", ")}。Pi CLIでパッケージ設定を確認してください。`,
		);
	}
	return loader;
}
