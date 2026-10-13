// Host と同じ登録処理を使い、ストーリーの Contribution 表示条件を準備する。
import type { UiContributionRegistry } from "../../../vscode-nerita/src/extension/ui-contributions/UiContributionRegistry";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { createBuiltinUiRegistry } from "../../../vscode-nerita/src/extension/ui-contributions/builtinContributions";

const models = [
	{ value: "openai/demo", name: "OpenAI" },
	{ value: "anthropic/demo", name: "Anthropic Claude" },
	{ value: "google/demo", name: "Google Gemini" },
	{ value: "local/demo", name: "Local model" },
];

/** プロバイダーに応じたモデルをストーリーの開始状態に設定する。 */
export function createContributionState(provider: string): ChatState {
	return {
		...initialState(),
		connection: "ready",
		sessionId: "contribution-story",
		configOptions: [
			{
				id: "model",
				name: "Model",
				currentValue: `${provider}/demo`,
				options: models,
			},
			{
				id: "reasoning_effort",
				name: "Reasoning effort",
				currentValue: "high",
				options: [
					{ value: "low", name: "Low" },
					{ value: "high", name: "High" },
				],
			},
		],
	};
}

/** 実サービスへ接続せず、表示条件付きの拡張設定を登録する。 */
export function createStoryContributions(): UiContributionRegistry {
	const result = createBuiltinUiRegistry();
	result.registerUiContribution("story.controls", (state) => [
		{
			id: "preview",
			slot: "settings.advanced",
			when: {
				backend: "pi",
				provider: "openai",
				capability: "preview",
			},
			control: {
				type: "toggle",
				configId: "preview",
				label: "拡張設定の例",
				checked: state.configOptions.some(
					(option) =>
						option.id === "preview" && option.currentValue === "on",
				),
				onValue: "on",
				offValue: "off",
			},
		},
		{
			id: "progress-example",
			slot: "status",
			when: { provider: "openai", capability: "preview" },
			control: {
				type: "progress",
				label: "タスク進捗の表示例",
				value: 68,
				description: "Story専用のサンプル値",
			},
		},
		{
			id: "header-example",
			slot: "model.header",
			control: {
				type: "select",
				option: {
					id: "header",
					name: "モデルヘッダーの拡張例",
					currentValue: "sample",
					options: [],
				},
			},
		},
		{
			id: "toolbar-example",
			slot: "composer.toolbar",
			control: {
				type: "select",
				option: {
					id: "toolbar",
					name: "ツールバーの拡張例",
					currentValue: "sample",
					options: [],
				},
			},
		},
	]);
	return result;
}
