// 既存ConfigOptionを宣言型UIへ変換し、backend固有の既定表示をHostに閉じ込める。
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
const tiers = ["fast-mode", "service_tier", "server_tier"];

/** provider固有の候補値はHostでtoggleの汎用値へ対応付ける。 */
function configControl(option: ConfigOption): NeritaUiControl {
	if (!tiers.includes(option.id)) {
		return { type: "select", option };
	}
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

/** Codexは従来の未接続枠を維持し、Piは実際に公開された設定だけを表示する。 */
const configContributions: UiContributionSource = (state, context) => {
	const options: ConfigOption[] = defaults.flatMap(([id, name]) => {
		const option =
			state.configOptions.find((item) => item.id === id) ??
			(id === "fast-mode"
				? state.configOptions.find((item) => tiers.includes(item.id))
				: undefined);
		return option
			? [option]
			: context.backend === "codex" && id !== "provider"
				? [{ id, name, currentValue: "", options: [] }]
				: [];
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

/** セッションごとにRegistryを所有し、別backendへの登録の漏出を防ぐ。 */
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
