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
				!(
					context.backend === "codex" &&
					item.id === "approvals_reviewer"
				) &&
				!tiers.includes(item.id) &&
				!options.some((option) => option.id === item.id),
		),
	);
	const visible = usesModelCard()
		? options.filter(
				(option) =>
					option.id !== "reasoning_effort" &&
					!tiers.includes(option.id),
			)
		: options;
	return visible.map((option, order): NeritaUiContribution => ({
		id: `config:${option.id}`,
		slot: "settings.main",
		order,
		when: { backend: context.backend },
		control: resolveControl(option),
	}));
	/** Codex と Pi の OpenAI 設定を同じモデルカードへまとめる。 */
	function usesModelCard(): boolean {
		return (
			context.backend === "codex" ||
			(["openai", "openai-codex"].includes(context.provider ?? "") &&
				options.some((option) => option.id === "model") &&
				options.some((option) => option.id === "reasoning_effort"))
		);
	}
	/** 権限とモデルの複合設定を、それぞれの表示条件で解決する。 */
	function resolveControl(option: ConfigOption): NeritaUiControl {
		if (context.backend === "codex" && option.id === "mode") {
			return permissionControl(option, state.configOptions);
		}
		if (usesModelCard() && option.id === "model") {
			return modelControl(option, options);
		}
		return configControl(option);
	}
};

/** モデル・推論量・速度設定を1つのカードへまとめる。 */
function modelControl(
	model: ConfigOption,
	options: ConfigOption[],
): NeritaUiControl {
	const effort = options.find((option) => option.id === "reasoning_effort")!;
	const tier = options.find((option) => tiers.includes(option.id));
	return {
		type: "slider-card",
		icon: "model",
		model,
		option: effort,
		fastMode: tier ? fastModeControl(tier) : undefined,
	};
}

/** 権限の表示と、書き込み時だけ見せる承認者を解決する。 */
function permissionControl(
	option: ConfigOption,
	options: ConfigOption[],
): NeritaUiControl {
	const reviewer = options.find((item) => item.id === "approvals_reviewer");
	const warning = option.currentValue === "danger-full-access";
	return {
		type: "slider-card",
		option,
		icon: warning ? "shield-alert" : "shield",
		warning,
		secondary:
			option.currentValue === "workspace-write" && reviewer
				? {
						option: reviewer,
						icon: reviewer.currentValue === "user" ? "user" : "bot",
					}
				: undefined,
	};
}

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
