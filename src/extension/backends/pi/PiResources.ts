// Pi標準のパッケージ解決を利用し、登録ツールをHostの承認へ接続する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { approvePiTool, type PiAuthorize } from "./PiApprovedTools";

/** CLIで導入したリソースを新規会話・再接続時に読み込む。 */
export async function loadPiResources(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	settingsManager: PiSdk.SettingsManager,
	authorize: PiAuthorize,
	signal: AbortSignal,
): Promise<PiSdk.DefaultResourceLoader> {
	const loader = new sdk.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		// ターミナル用のテーマはVS Code Webviewには適用しない。
		noThemes: true,
		extensionsOverride(result) {
			for (const extension of result.extensions) {
				for (const [name, tool] of extension.tools) {
					extension.tools.set(name, {
						...tool,
						definition: approvePiTool(
							tool.definition,
							cwd,
							authorize,
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
