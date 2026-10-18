// 固定モデルへの切替時に、利用可能な候補から既定モデルを選ぶ。
import type { BackendId } from "../backend";
import type { ManagerModel } from "./messages";

// 順序はプロバイダーの優先順位。正確なモデル ID が未確認の既定値は指定しない。
const piDefaults: readonly { provider: string; model?: string }[] = [
	{ provider: "openai", model: "gpt-6-luna" },
	{ provider: "anthropic" },
	{ provider: "google" },
];

/** 既定値が候補にない場合も、未確認のモデルを作らず利用可能な先頭候補を返す。 */
export function defaultHandoffModel(
	backend: BackendId,
	models: readonly ManagerModel[],
) {
	const preferred: string[] = [];
	if (backend === "codex") {
		preferred.push("gpt-6-luna");
	} else {
		for (const { provider, model } of piDefaults) {
			if (model !== undefined) {
				preferred.push(`${provider}/${model}`);
			}
		}
	}
	return (
		preferred.find((value) =>
			models.some((model) => model.value === value),
		) ?? models[0]?.value
	);
}
