// SDK のモデル別推論候補を、子起動を伴わない管理画面へ公開する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { PiCatalogModel } from "./PiModelCatalog";
import { PiModelCatalogService } from "./PiModelCatalogService";
import type { ManagerModel } from "@nerita/shared/agentManager/messages";

/** 認証済み SDK 候補をライブカタログで絞り、現在の会話のモデル選択には触れない。 */
export async function readPiAgentModels(
	models: ModelRuntime,
	supportedThinking: (
		model: NonNullable<AgentSession["model"]>,
	) => readonly string[],
	signal: AbortSignal,
	request: typeof fetch = fetch,
): Promise<ManagerModel[]> {
	const available = await models.getAvailable(undefined, { signal });
	const catalog = new PiModelCatalogService(
		models,
		{ model: undefined },
		request,
	);
	for (const provider of new Set(available.map((model) => model.provider))) {
		await catalog.refresh(provider, signal);
	}
	signal.throwIfAborted();
	return catalog
		.available(available)
		.map((model) =>
			piAgentModel(
				model,
				supportedThinking(model),
				catalog.metadata(model.provider, model.id),
			),
		);
}

/** 表示名は公開カタログを使い、推論値はモデル自身の SDK 能力に限定する。 */
export function piAgentModel(
	model: NonNullable<AgentSession["model"]>,
	levels: readonly string[] | undefined,
	metadata?: PiCatalogModel,
): ManagerModel {
	const efforts = levels;
	return {
		value: `${model.provider}/${model.id}`,
		name: `${model.provider} / ${metadata?.displayName ?? model.name}`,
		...(efforts ? { efforts: [...efforts] } : {}),
	};
}
