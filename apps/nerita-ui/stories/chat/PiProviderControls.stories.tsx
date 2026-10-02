// Host から届く設定 DTO を固定し、ブラウザーでは描画と設定要求だけを再現する。

import { type SetStateAction, type Dispatch, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBuiltinUiRegistry } from "../../../../apps/vscode-nerita/src/extension/ui-contributions/builtinContributions";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import type { ConfigOption } from "@nerita/shared/composer";
import type { UiMessage } from "@nerita/shared/messages";
import { ComposerSettings } from "../../src/chat/composer/ComposerSettings";
import "../../src/chat/chat.css";

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
const connected = [provider, model, reasoning, fast];
const fallback = [
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
const anthropic = [
	{ ...provider, currentValue: "anthropic" },
	{
		...model,
		currentValue: "anthropic/claude",
		options: [{ value: "anthropic/claude", name: "Claude" }],
	},
	{ ...reasoning, options: [{ value: "high", name: "high" }] },
];

/** モデルのメタデータを取得できない状態を再現するかどうかの指定。 */
type ProviderControlsStoryProps = {
	noMetadata?: boolean;
};

/** 設定要求へ固定の応答を返し、実サービスや SDK を起動しない。 */
function ProviderControlsStory({
	noMetadata = false,
}: ProviderControlsStoryProps) {
	const registry = useMemo(createBuiltinUiRegistry, []);
	const [state, setState] = useState<ChatState>(() => ({
		...initialState(),
		connection: "ready",
		sessionId: "pi-controls-story",
		configOptions: noMetadata ? fallback : connected,
		quota: [
			{
				label: "Weekly",
				remaining: 82,
				detail: "リセット: 2026-09-28T10:00:00Z",
				source: "codex-login",
			},
		],
	}));
	const [requests, setRequests] = useState<UiMessage[]>([]);
	/** UI が送った値を記録し、次の状態通知を模擬する。 */
	const send = createProviderControlsSender(setRequests, setState);
	const contributions = registry.resolve(state, {
		backend: "pi",
		provider:
			state.configOptions.find((option) => option.id === "provider")
				?.currentValue ?? null,
		capabilities: [],
	});
	return (
		<div className="p-[12px]">
			<p>Pi Provider Controls</p>
			<div className="flex flex-wrap gap-[4px]">
				<button
					onClick={() =>
						setState((current) => ({
							...current,
							run: current.run === "running" ? "idle" : "running",
						}))
					}
				>
					実行状態を切替
				</button>
				<button
					onClick={() =>
						setState((current) => ({
							...current,
							connection: "disconnected",
						}))
					}
				>
					切断
				</button>
				<button
					onClick={() =>
						setState((current) => ({ ...current, quota: null }))
					}
				>
					利用枠取得失敗
				</button>
			</div>
			<ComposerSettings
				state={{ ...state, uiContributions: contributions }}
				send={send}
			/>
			<output
				aria-label="送信した要求"
				className="mt-[12px] block text-[11px] [overflow-wrap:anywhere]"
			>
				{JSON.stringify(requests)}
			</output>
		</div>
	);
}

const meta = {
	title: "Chat/Pi Provider Controls",
	component: ProviderControlsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProviderControlsStory>;
export default meta;
/** 利用可能な設定と、メタデータを取得できなかった設定を分ける。 */
type Story = StoryObj<typeof meta>;
export const Connected: Story = {};
export const NoMetadata: Story = { args: { noMetadata: true } };

/** 送信要求を記録し、プロバイダー変更の応答を模擬する。 */
function createProviderControlsSender(
	setRequests: Dispatch<SetStateAction<UiMessage[]>>,
	setState: Dispatch<SetStateAction<ChatState>>,
) {
	return (message: UiMessage) => {
		setRequests((previous) => [...previous, message]);
		if (message.type !== "config/set") {
			return;
		}
		const providerOptions =
			message.value === "anthropic" ? anthropic : connected;
		setState((current) => ({
			...current,
			quota: message.configId === "provider" ? null : current.quota,
			configOptions:
				message.configId === "provider"
					? providerOptions
					: current.configOptions.map((option) =>
							option.id === message.configId
								? { ...option, currentValue: message.value }
								: option,
						),
		}));
	};
}
