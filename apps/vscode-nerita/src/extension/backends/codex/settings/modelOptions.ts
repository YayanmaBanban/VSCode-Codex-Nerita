// モデルの対応能力から表示候補を生成し、会話状態の更新とは分離する。

import type { ConfigOption } from "@nerita/shared/composer";
import {
	codexSandboxChoices,
	codexReviewerChoices,
	reasoningLabel,
} from "@nerita/shared/settingsCards";
import type { ModelInfo } from "../protocol/account";
import { reasoningLevels } from "./modelSelection";

/** モデル能力と会話設定から、Codex 専用の選択候補を構成する。 */
export function modelOptions(
	models: ModelInfo[],
	model: string,
	effort: string,
	tier: string,
	initialTier: string | null,
	mode: string,
	collaborationMode = "default",
	approvalsReviewer: string,
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
		reasoningOption(effort, selected),
		serviceTierOption(tier, selected),
		{
			id: "mode",
			name: "Mode",
			currentValue: mode,
			currentLabel: "権限は未取得または外部管理です",
			options: codexSandboxChoices,
		},
		{
			id: "approvals_reviewer",
			name: "ApprovalsReviewer",
			currentValue: approvalsReviewer,
			options: codexReviewerChoices,
		},
	];
	if (
		selected?.serviceTiers.some((item) => item.id === "priority") === true
	) {
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

/** 利用可能なサービス階層を選択肢として表示する。 */
function serviceTierOption(
	tier: string,
	selected: ModelInfo | undefined,
): ConfigOption {
	return {
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
	};
}

/** 選択したモデルが対応する推論候補を順序付きで生成する。 */
function reasoningOption(
	effort: string,
	selected: ModelInfo | undefined,
): ConfigOption {
	return {
		id: "reasoning_effort",
		name: "Reasoning effort",
		currentValue: effort,
		options:
			selected?.supportedReasoningEfforts
				.filter((item) =>
					reasoningLevels.includes(item.reasoningEffort),
				)
				.sort(
					(a, b) =>
						reasoningLevels.indexOf(a.reasoningEffort) -
						reasoningLevels.indexOf(b.reasoningEffort),
				)
				.map((item) => ({
					value: item.reasoningEffort,
					name: reasoningLabel(item.reasoningEffort),
					description: item.description,
				})) ?? [],
	};
}
