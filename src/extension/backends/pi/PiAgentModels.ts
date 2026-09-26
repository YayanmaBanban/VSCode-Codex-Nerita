// プロバイダーのモデル能力を優先し、不在の場合だけ SDK の推論候補を使う。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiCatalogModel } from "./PiModelCatalog";
import type { ManagerModel } from "../../../shared/agentManager/messages";

/** 設定管理ではモデルの公開能力を優先し、SDK の標準列挙値で切り落とさない。 */
export function piAgentModel(
	model: NonNullable<AgentSession["model"]>,
	levels: readonly string[] | undefined,
	metadata?: PiCatalogModel,
): ManagerModel {
	const efforts = metadata?.reasoningLevels ?? levels;
	return {
		value: `${model.provider}/${model.id}`,
		name: `${model.provider} / ${metadata?.displayName ?? model.name}`,
		...(efforts ? { efforts: [...efforts] } : {}),
	};
}
