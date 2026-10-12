// 共通のモデルカードへ、管理画面の編集値とモデル候補を渡す。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { ConfigChoice, ConfigOption } from "@nerita/shared/composer";

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
