// モデルの対応能力から表示候補を生成し、会話状態の更新とは分離する。
import type { ConfigOption } from "../../../../shared/composer";
import type { ModelInfo } from "../protocol/account";

/** モデル能力と会話設定から、Codex専用の選択候補を構成する。 */
export function modelOptions(
	models: ModelInfo[],
	model: string,
	effort: string,
	tier: string,
	initialTier: string | null,
	mode: string,
	collaborationMode = "default",
): ConfigOption[] {
	const selected = models.find((item) => item.model === model);
	const options: ConfigOption[] = [
		{
			id: "collaboration_mode",
			name: "Collaboration mode",
			currentValue: collaborationMode,
			options: [
				{ value: "default", name: "Default" },
				{ value: "plan", name: "Plan" },
				{ value: "goal", name: "Goal" },
			],
		},
		{
			id: "model",
			name: "Model",
			currentValue: model,
			options: models.map((item) => ({
				value: item.model,
				name: item.displayName,
			})),
		},
		{
			id: "reasoning_effort",
			name: "Reasoning effort",
			currentValue: effort,
			options:
				selected?.supportedReasoningEfforts.map((item) => ({
					value: item.reasoningEffort,
					name: item.reasoningEffort,
					description: item.description,
				})) ?? [],
		},
		{
			id: "service_tier",
			name: "Service tier",
			currentValue: tier,
			options: [
				{ value: "inherit", name: "設定を引き継ぐ" },
				{ value: "default", name: "Standard" },
				...(selected?.serviceTiers.map((item) => ({
					value: item.id,
					name: item.name,
					description: item.description,
				})) ?? []),
			],
		},
		{
			id: "mode",
			name: "Mode",
			currentValue: mode,
			options: [
				{ value: "inherit", name: "設定を引き継ぐ" },
				{ value: "read-only", name: "読み取り専用" },
				{
					value: "workspace-write",
					name: "ワークスペース内に書き込み",
				},
				{ value: "danger-full-access", name: "フルアクセス" },
			],
		},
	];
	if (selected?.serviceTiers.some((item) => item.id === "priority")) {
		options.push({
			id: "fast-mode",
			name: "Fast mode",
			currentValue:
				(tier === "inherit" ? initialTier : tier) === "priority"
					? "on"
					: "off",
			options: [
				{
					value: "on",
					name: "On",
					description: selected.serviceTiers.find(
						(item) => item.id === "priority",
					)!.description,
				},
				{ value: "off", name: "Off" },
			],
		});
	}
	return options;
}
