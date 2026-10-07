// 子ツールの生結果を SDK のイベントと履歴へ渡す前に、認証値を除去する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiToolFeatures } from "./PiToolFeatures";
import { privateFeatureResult, privateFeatureText } from "./PiFeatureSafety";

/** 通常ツールの承認と副作用を維持し、結果だけに共通の保護を加える。 */
export function protectPiFeatureTool(
	tool: ToolDefinition,
	features: PiToolFeatures,
): ToolDefinition {
	if (
		!(features.codemode === true) &&
		!(features.toolSearch === true) &&
		!features.protect
	) {
		return tool;
	}
	return {
		...tool,
		async execute(id, params, signal, update, context) {
			const secrets = (await features.secrets?.()) ?? [];
			try {
				return privateFeatureResult(
					await tool.execute(
						id,
						params,
						signal,
						update
							? (result) =>
									update(
										privateFeatureResult(
											result,
											secrets,
											features.protect,
										),
									)
							: undefined,
						context,
					),
					secrets,
					features.protect,
				);
			} catch (error) {
				if (error instanceof Error) {
					error.message = privateFeatureText(
						error.message,
						secrets,
						features.protect,
					);
					error.stack = `${error.name}: ${error.message}`;
				}
				throw error;
			}
		},
	};
}
