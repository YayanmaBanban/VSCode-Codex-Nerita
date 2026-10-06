// Nerita 組み込み拡張は VSIX 内から注入し、ワークスペースの `.pi/extensions` へ書き込まない。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type {
	ExtensionFactory,
	InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { PiProviderControls } from "./PiProviderControls";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { guardedPiFeature, type PiToolFeatures } from "./PiToolFeatures";
import type { PiAuthorize } from "./PiApprovedTools";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";

/** 同梱エントリーポイントにのみ公開する検索ファクトリー。 */
export type PiFeatureSdk = typeof PiSdk & {
	createToolSearchExtension: () => ExtensionFactory;
};

/** 設定を注入しない利用側では通常の Pi 要求を維持する。 */
export const neritaProviderExtension: ExtensionFactory = (pi) => {
	pi.on("before_provider_request", () => undefined);
};

/** プロバイダー固有の要求変換を行う、名前付きの組み込み拡張を作る。 */
export function neritaExtensionFactories(
	controls?: PiProviderControls,
	featureContext?: {
		sdk: PiFeatureSdk;
		features: PiToolFeatures;
		cwd: string;
		authorize: PiAuthorize;
		policy?: AgentAccessPolicy;
		signal: AbortSignal;
	},
): InlineExtension[] {
	const extensions: InlineExtension[] = [
		{
			name: "nerita-provider-controls",
			factory: controls
				? (pi) => {
						pi.on("before_provider_request", (event, context) =>
							controls.rewrite(event.payload, context.model),
						);
						pi.on("before_agent_start", (event) => {
							const prompt = controls.delegationPrompt();
							return isNonEmptyString(prompt)
								? {
										systemPrompt: `${event.systemPrompt}\n\n${prompt}`,
									}
								: undefined;
						});
					}
				: neritaProviderExtension,
		},
	];
	if (featureContext) {
		const { sdk, features, cwd, authorize, policy, signal } =
			featureContext;
		for (const [name, enabled, factory] of [
			[
				"nerita-codemode",
				features.codemode,
				() =>
					sdk.createCodemodeExtension({
						models: false,
						mode: "on",
						inlineBudget: 3000,
					}),
			],
			[
				"nerita-tool-search",
				features.toolSearch,
				() => sdk.createToolSearchExtension(),
			],
		] as const) {
			if (enabled === true) {
				extensions.push({
					name,
					factory: guardedPiFeature(
						factory(),
						features,
						cwd,
						authorize,
						policy,
						signal,
					),
				});
			}
		}
	}
	return extensions;
}
