// SDK の利用可能モデルと推論メタデータを、秘密値を含まない設定候補へ変換する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ConfigOption } from "../../../shared/composer";
import type { PiProviderControls } from "./PiProviderControls";
import type { PiModelCatalogService } from "./PiModelCatalogService";

/** UI はこの候補を Contribution へ変換し、プロバイダー固有の分岐を持たない。 */
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
						currentLabel: modelDisplayName(catalog, model),
					}
				: {}),
			options: (catalog?.available(available) ?? available)
				.filter((item) => !model || item.provider === model.provider)
				.map((item) => ({
					value: `${item.provider}/${item.id}`,
					name:
						catalog?.metadata(item.provider, item.id)
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

/** カタログの表示名を優先してモデル名を返す。 */
function modelDisplayName(
	catalog: PiModelCatalogService | undefined,
	model: NonNullable<AgentSession["model"]>,
): string {
	return (
		catalog?.metadata(model.provider, model.id)?.displayName ?? model.name
	);
}
