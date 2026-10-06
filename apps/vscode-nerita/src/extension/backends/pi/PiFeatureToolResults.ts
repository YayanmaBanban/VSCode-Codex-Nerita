// 子ツールの生結果を SDK のイベントと履歴へ渡す前に、認証値を除去する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiToolFeatures } from "./PiToolFeatures";
import { privateFeatureValue } from "./PiFeatureSafety";

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
				const result = privateFeatureValue(
					await tool.execute(
						id,
						params,
						signal,
						update
							? (result) =>
									update(
										features.protect?.(
											privateFeatureValue(
												result,
												secrets,
											),
										) ??
											privateFeatureValue(
												result,
												secrets,
											),
									)
							: undefined,
						context,
					),
					secrets,
				);
				return features.protect?.(result) ?? result;
			} catch (error) {
				if (error instanceof Error) {
					error.message = privateFeatureValue(error.message, secrets);
					error.message =
						features.protect?.(error.message) ?? error.message;
					error.stack = `${error.name}: ${error.message}`;
				}
				throw error;
			}
		},
	};
}
