// Host で速度設定を汎用の `toggle` 宣言へ変換する。
import type { ConfigOption } from "../../shared/composer";
import type { NeritaUiControl } from "../../shared/uiContributions";

/** サーバーが公開する速度設定の別名。 */
export const fastModeConfigIds: readonly string[] = [
	"fast-mode",
	"service_tier",
	"server_tier",
];

/** 候補の送信値と説明を維持し、不完全な候補は操作不可にする。 */
export function fastModeControl(
	option: ConfigOption,
): Extract<NeritaUiControl, { type: "toggle" }> {
	const onValue =
		option.id === "fast-mode"
			? "on"
			: (option.options.find((item) =>
					["priority", "fast"].includes(item.value),
				)?.value ?? "priority");
	const offValue = option.id === "fast-mode" ? "off" : "default";
	const description =
		option.options.find((item) => item.value === option.currentValue)
			?.description ?? option.description;
	return {
		type: "toggle",
		configId: option.id,
		label: option.id === "fast-mode" ? option.name : "Fast mode",
		checked: option.currentValue === onValue,
		onValue,
		offValue,
		disabled: ![onValue, offValue].every((value) =>
			option.options.some((item) => item.value === value),
		),
		...(description ? { description } : {}),
	};
}
