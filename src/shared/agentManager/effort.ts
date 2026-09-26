// モデルを明示した設定だけを照合し、バックエンドの優先順位は解決しない。
import type { ManagerModel } from "./messages";
import type { HandoffConfig } from "./config";

/** バックエンドごとの保存キーから推論指定を取り出す。 */
function backendEffort(item: HandoffConfig["backends"]["pi" | "codex"]) {
	if ("thinking" in item) {
		return item.thinking;
	}
	if ("reasoningEffort" in item) {
		return item.reasoningEffort;
	}
	return undefined;
}

/** current の実行モデルは保存時に確定しないため、fixed だけを照合する。 */
export function handoffEffortError(
	config: HandoffConfig,
	previous: HandoffConfig,
	models: Record<"pi" | "codex", ManagerModel[]>,
): string | undefined {
	for (const backend of ["pi", "codex"] as const) {
		const item = config.backends[backend];
		const old = previous.backends[backend];
		if (item.strategy !== "fixed") {
			continue;
		}
		const error = effortError(
			models[backend],
			item.model,
			backendEffort(item),
			old.strategy === "fixed" ? old.model : undefined,
			backendEffort(old),
		);
		if (error) {
			return `${backend}: ${error}`;
		}
	}
	return undefined;
}

/** 未接続の既存値は保持できるが、新しい組合せは確認済みの候補に限定する。 */
export function effortError(
	models: ManagerModel[],
	model: string | undefined,
	effort: string | undefined,
	previousModel?: string,
	previousEffort?: string,
): string | undefined {
	if (!effort) {
		return undefined;
	}
	const options = models.find((item) => item.value === model)?.efforts;
	if (options) {
		return options.includes(effort)
			? undefined
			: "このモデルでは非対応の推論レベルです。選び直してください。";
	}
	if (model === previousModel && effort === previousEffort) {
		return undefined;
	}
	return "推論レベルを確認できません。モデルを指定し、モデル一覧を再読み込みしてください。";
}

/** 未指定・未接続のモデルについて、対応値を推測しない。 */
export function effortOptions(
	models: ManagerModel[],
	model: string | undefined,
): string[] {
	return models.find((item) => item.value === model)?.efforts ?? [];
}
