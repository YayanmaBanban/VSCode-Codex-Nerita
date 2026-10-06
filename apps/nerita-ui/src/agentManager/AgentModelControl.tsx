// 共通のモデルカードへ、管理画面の編集値とモデル候補を渡す。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import type { ManagerModel } from "@nerita/shared/agentManager/messages";
import type { ConfigChoice, ConfigOption } from "@nerita/shared/composer";
import { modelControl, reasoningLabel } from "@nerita/shared/settingsCards";
import { SliderCard } from "../contributions/SliderCard";

/** 未接続の保存済み値も候補に残し、バックエンドに応じて未指定を許す。 */
export function managerOption(
	id: string,
	name: string,
	value: string | undefined,
	choices: ConfigChoice[],
	allowUnspecified = true,
): ConfigOption {
	return {
		id,
		name,
		currentValue: value ?? "",
		options: [
			...(allowUnspecified ? [{ value: "", name: "未指定" }] : []),
			...(isNonEmptyString(value) &&
			!choices.some((item) => item.value === value)
				? [{ value, name: `${value}（保存済み）` }]
				: []),
			...choices,
		],
	};
}

/** 候補は選択モデルに追従し、モデル変更による推論エラーは親フォームで表示する。 */
export function AgentModelControl({
	models,
	model,
	effort,
	disabled,
	onChange,
	allowUnspecified = true,
}: {
	models: ManagerModel[];
	model?: string | undefined;
	effort?: string | undefined;
	disabled: boolean;
	allowUnspecified?: boolean;
	onChange: (
		key: "model" | "reasoning_effort",
		value: string | undefined,
	) => void;
}) {
	const option = managerOption(
		"model",
		"モデル",
		model,
		models,
		allowUnspecified,
	);
	const reasoning = managerOption(
		"reasoning_effort",
		"推論",
		effort,
		(models.find((item) => item.value === model)?.efforts ?? []).map(
			(value) => ({ value, name: reasoningLabel(value) }),
		),
		allowUnspecified,
	);
	return (
		<div>
			<SliderCard
				control={modelControl(option, [reasoning])}
				disabled={disabled}
				onChange={(key, value) =>
					onChange(
						key === "model" ? "model" : "reasoning_effort",
						nonEmptyString(value) ?? undefined,
					)
				}
			/>
		</div>
	);
}
