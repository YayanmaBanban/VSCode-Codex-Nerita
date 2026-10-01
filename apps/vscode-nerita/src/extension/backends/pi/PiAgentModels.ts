// SDK のモデル別推論候補を、子起動を伴わない管理画面へ公開する。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiCatalogModel } from "./PiModelCatalog";
import type { ManagerModel } from "@nerita/shared/agentManager/messages";

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
