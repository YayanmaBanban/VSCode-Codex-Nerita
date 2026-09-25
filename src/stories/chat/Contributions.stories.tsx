// Host の Registry を模した状態更新で、同じ UI の `backend/provider` 差分を観察する。
import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { BackendId } from "../../shared/backend";
import { initialState, type ChatState } from "../../shared/chatState";
import type { UiMessage } from "../../shared/messages";
import { createBuiltinUiRegistry } from "../../extension/ui-contributions/builtinContributions";
import { ComposerSettings } from "../../webview/chat/composer/ComposerSettings";
import "../../webview/chat/chat.css";

const models = [
	{ value: "openai-codex/demo", name: "OpenAI Codex" },
	{ value: "anthropic/demo", name: "Anthropic Claude" },
	{ value: "google/demo", name: "Google Gemini" },
	{ value: "local/demo", name: "Local model" },
];

/** 実サービスへ接続せず、Host と同じ条件解決・`config/set` 契約を使う。 */
function ContributionStory({
	backend,
	provider,
}: {
	backend: BackendId;
	provider: string;
}) {
	const registry = useMemo(() => {
		const result = createBuiltinUiRegistry();
		result.registerUiContribution("story.controls", (state) => [
			{
				id: "preview",
				slot: "settings.advanced",
				when: {
					backend: "pi",
					provider: "openai-codex",
					capability: "preview",
				},
				control: {
					type: "toggle",
					configId: "preview",
					label: "拡張設定の例",
					checked: state.configOptions.some(
						(option) =>
							option.id === "preview" &&
							option.currentValue === "on",
					),
					onValue: "on",
					offValue: "off",
				},
			},
			{
				id: "progress-example",
				slot: "status",
				when: { provider: "openai-codex", capability: "preview" },
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
	}, []);
	const [state, setState] = useState<ChatState>(() => ({
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
	}));
	const [last, setLast] = useState<UiMessage>();
	const selectedProvider = state.configOptions
		.find((option) => option.id === "model")!
		.currentValue.split("/")[0]!;
	// `preview` はストーリーだけの能力であり、Phase 8の Fast `Mode` を実装済みとは扱わない。
	const contributions = registry.resolve(state, {
		backend,
		provider: selectedProvider,
		capabilities: ["preview"],
	});
	/** 通信の応答を模し、UI のローカル値ではなく Host の再生成結果を反映する。 */
	const send = (message: UiMessage) => {
		setLast(message);
		if (message.type === "config/set") {
			setState((current) => ({
				...current,
				configOptions:
					message.configId === "preview"
						? [
								...current.configOptions.filter(
									(option) => option.id !== "preview",
								),
								{
									id: "preview",
									name: "Preview",
									currentValue: message.value,
									options: [],
								},
							]
						: current.configOptions.map((option) =>
								option.id === message.configId
									? { ...option, currentValue: message.value }
									: option,
							),
			}));
		}
	};
	// `preview` の内部状態を通常 `ConfigOption` 表示へ二重公開しない。
	contributions.items = contributions.items.filter(
		(item) => item.id !== "config:preview",
	);
	return (
		<div className="p-[12px]">
			<p>UI Contribution — {backend}</p>
			<p className="text-[12px] text-muted">
				モデルを切り替えると、Hostの定義に合わせて拡張設定の表示が変わります。
			</p>
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
			<ComposerSettings
				state={{ ...state, uiContributions: contributions }}
				send={send}
			/>
			<output
				aria-label="最後の要求"
				className="block mt-[12px] text-[11px] [overflow-wrap:anywhere]"
			>
				{last ? JSON.stringify(last) : "未操作"}
			</output>
		</div>
	);
}

const meta = {
	title: "Chat/Contributions",
	component: ContributionStory,
	parameters: { layout: "fullscreen" },
	args: { backend: "pi", provider: "openai-codex" },
} satisfies Meta<typeof ContributionStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CodexAppServer: Story = { args: { backend: "codex" } };
export const PiCodex: Story = {};
export const PiAnthropic: Story = { args: { provider: "anthropic" } };
export const PiGoogle: Story = { args: { provider: "google" } };
export const PiLocal: Story = { args: { provider: "local" } };
