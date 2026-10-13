// Host から通知済みの Pi 設定 DTO の表示例を提供する。
import type { ConfigOption } from "@nerita/shared/composer";

const provider: ConfigOption = {
	id: "provider",
	name: "Provider",
	currentValue: "openai",
	options: [
		{ value: "openai", name: "openai" },
		{ value: "anthropic", name: "anthropic" },
	],
};
const model: ConfigOption = {
	id: "model",
	name: "Pi Model",
	currentValue: "openai/max-model",
	options: [{ value: "openai/max-model", name: "GPT-6-Astra" }],
};
const reasoning: ConfigOption = {
	id: "reasoning_effort",
	name: "Reasoning effort",
	currentValue: "high",
	options: [
		{ value: "high", name: "high" },
		{ value: "ultra", name: "Ultra" },
	],
};
// 候補の計算・除外・推論補正は Host テストの責任とし、ここでは受信済みの例だけを持つ。
const fast: ConfigOption = {
	id: "fast-mode",
	name: "Fast mode",
	currentValue: "off",
	options: [
		{ value: "on", name: "On" },
		{ value: "off", name: "Off" },
	],
};
export const connected = [provider, model, reasoning, fast];
export const fallback = [
	provider,
	{
		...model,
		currentValue: "openai/gpt-6.1-sol",
		options: [{ value: "openai/gpt-6.1-sol", name: "GPT-6.1-Sol" }],
	},
	{
		...reasoning,
		options: [
			{ value: "high", name: "high" },
			{ value: "max", name: "max" },
		],
	},
];
export const anthropic = [
	{ ...provider, currentValue: "anthropic" },
	{
		...model,
		currentValue: "anthropic/claude",
		options: [{ value: "anthropic/claude", name: "Claude" }],
	},
	{ ...reasoning, options: [{ value: "high", name: "high" }] },
];
