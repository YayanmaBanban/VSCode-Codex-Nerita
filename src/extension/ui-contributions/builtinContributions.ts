// 既存 `ConfigOption` を宣言型 UI へ変換し、バックエンド固有の既定表示を Host に閉じ込める。
import { fastModeControl, fastModeConfigIds as tiers } from "./fastModeControl";
import type { ConfigOption } from "../../shared/composer";
import type {
	NeritaUiContribution,
	NeritaUiControl,
} from "../../shared/uiContributions";
import {
	UiContributionRegistry,
	type UiContributionSource,
} from "./UiContributionRegistry";

const defaults = [
	["mode", "Mode"],
	["collaboration_mode", "Collaboration mode"],
	["provider", "Provider"],
	["model", "Model"],
	["reasoning_effort", "Reasoning effort"],
	["fast-mode", "Fast mode"],
] as const;
/** 既存の速度設定だけ共通の切替値へ対応付ける。 */
function configControl(option: ConfigOption): NeritaUiControl {
	return tiers.includes(option.id)
		? fastModeControl(option)
		: { type: "select", option };
}
/** Codex は従来の未接続枠を維持し、Pi は実際に公開された設定だけを表示する。 */
const configContributions: UiContributionSource = (state, context) => {
	const options: ConfigOption[] = defaults.flatMap(([id, name]) => {
		const option =
			state.configOptions.find((item) => item.id === id) ??
			(id === "fast-mode"
				? state.configOptions.find((item) => tiers.includes(item.id))
				: undefined);
		if (option) {
			return [option];
		}
		if (context.backend === "codex" && id !== "provider") {
			return [{ id, name, currentValue: "", options: [] }];
		}
		return [];
	});
	options.push(
		...state.configOptions.filter(
			(item) =>
				!tiers.includes(item.id) &&
				!options.some((option) => option.id === item.id),
		),
	);
	return options.map((option, order): NeritaUiContribution => ({
		id: `config:${option.id}`,
		slot: "settings.main",
		order,
		when: { backend: context.backend },
		control: configControl(option),
	}));
};

/** セッションごとに Registry を所有し、別バックエンドへの登録の漏出を防ぐ。 */
export function createBuiltinUiRegistry(): UiContributionRegistry {
	const registry = new UiContributionRegistry();
	registry.registerUiContribution("nerita.config", configContributions);
	registry.registerUiContribution("nerita.quota", (state) =>
		state.connection === "ready" && state.quota?.length
			? [
					{
						id: "quota",
						slot: "status",
						order: 0,
						control: {
							type: "quota",
							windows: state.quota,
						},
					},
				]
			: [],
	);
	return registry;
}
