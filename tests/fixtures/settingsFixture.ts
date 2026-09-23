// Story と回帰テスト用に、接続応答と同じ構造の設定例を定義する。
import type { ConfigOption } from "../../src/shared/composer";

/** 表示名と送信値が異なる設定候補を作る。 */
export function settingsFixture(): ConfigOption[] {
	return [
		{
			id: "mode",
			name: "Mode",
			currentValue: "agent",
			options: [
				{ value: "read-only", name: "Ask for approval" },
				{
					value: "agent",
					name: "Approve for me",
					description:
						"Only ask for actions detected as potentially unsafe",
				},
				{ value: "agent-full-access", name: "Full access" },
			],
		},
		{
			id: "collaboration_mode",
			name: "Collaboration mode",
			currentValue: "default",
			options: [
				{ value: "default", name: "Default" },
				{
					value: "plan",
					name: "Plan",
					description: "Plan before making changes",
				},
				{ value: "goal", name: "Goal" },
			],
		},
		{
			id: "model",
			name: "Model",
			currentValue: "gpt-6-astra",
			options: [
				{
					value: "gpt-6-astra",
					name: "6 Astra",
					description:
						"Our most capable model for complex, demanding work.",
				},
				{
					value: "gpt-5.6-luna",
					name: "5.6 Luna",
					description: "Fast and affordable agentic coding model.",
				},
			],
		},
		{
			id: "reasoning_effort",
			name: "Reasoning effort",
			currentValue: "low",
			options: [
				{
					value: "low",
					name: "Low",
					description: "Fast responses with lighter reasoning",
				},
				{ value: "high", name: "High" },
				{ value: "ultra", name: "Ultra" },
			],
		},
		{
			id: "fast-mode",
			name: "Fast mode",
			currentValue: "off",
			description: "1.5x speed, increased usage",
			options: [
				{
					value: "off",
					name: "Off",
					description: "Default speed, normal usage",
				},
				{
					value: "on",
					name: "On",
					description: "1.5x speed, increased usage",
				},
			],
		},
	];
}
