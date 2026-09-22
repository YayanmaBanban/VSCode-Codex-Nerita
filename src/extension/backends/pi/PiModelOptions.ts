// SDKの利用可能モデルと推論metadataを、秘密値を含まない設定候補へ変換する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ConfigOption } from "../../../shared/composer";
import type { PiProviderControls } from "./PiProviderControls";
import type { PiModelCatalogService } from "./PiModelCatalogService";

/** UIはこの候補をContributionへ変換し、provider固有の分岐を持たない。 */
export function piModelOptions(
	session: AgentSession,
	controls: PiProviderControls,
	available: ReturnType<ModelRuntime["getAvailableSnapshot"]>,
	catalog?: PiModelCatalogService,
): ConfigOption[] {
	const model = session.model;
	const state = controls.snapshot();
	return [
		{
			id: "model",
			name: "Pi Model",
			currentValue: model ? `${model.provider}/${model.id}` : "",
			...(model
				? {
						currentLabel:
							catalog
								?.snapshot(model.provider)
								?.find((entry) => entry.slug === model.id)
								?.displayName ?? model.name,
					}
				: {}),
			options: (catalog?.available(available) ?? available)
				.filter((item) => !model || item.provider === model.provider)
				.map((item) => ({
					value: `${item.provider}/${item.id}`,
					name:
						catalog
							?.snapshot(item.provider)
							?.find((entry) => entry.slug === item.id)
							?.displayName ?? item.name,
				})),
		},
		{
			id: "reasoning_effort",
			name: "Reasoning effort",
			currentValue: state.effectiveReasoning,
			currentLabel: state.effectiveReasoning,
			options: controls.reasoningOptions,
		},
		{
			id: "provider",
			name: "Provider",
			currentValue: model?.provider ?? "",
			options: [...new Set(available.map((item) => item.provider))].map(
				(provider) => ({ value: provider, name: provider }),
			),
		},
		...controls.configOptions,
	];
}
