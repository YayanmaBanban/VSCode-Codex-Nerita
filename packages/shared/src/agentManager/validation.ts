// 管理画面と保存処理で、名前の重複と新しいモデル指定の条件を共用する。
import type { BackendId } from "../backend";
import { isNonEmptyString } from "../valuePredicates";
import type { ManagedAgent, ManagerModel } from "./messages";

/** 同じバックエンドの定義だけを照合し、編集している定義自身は重複から除く。 */
export function agentNameError(
	agents: readonly ManagedAgent[],
	backend: BackendId,
	name: string,
	id?: string,
) {
	const duplicate = agents.some(
		(agent) =>
			agent.backend === backend && agent.name === name && agent.id !== id,
	);
	return duplicate ? "同名の Agent が存在します。" : undefined;
}

/** 未指定への変更と既存の保存値は許容し、新しい指定は取得済み候補に限定する。 */
export function agentModelError(
	models: readonly ManagerModel[],
	model: string | undefined,
	previous?: string,
) {
	if (!isNonEmptyString(model) || model === previous) {
		return undefined;
	}
	return models.some((item) => item.value === model)
		? undefined
		: "モデル一覧を再読み込みし、利用可能なモデルから選択してください。";
}
