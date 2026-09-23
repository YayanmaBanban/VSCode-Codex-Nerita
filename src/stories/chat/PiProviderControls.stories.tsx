// 実Hostの設定クラスとRegistryで、provider切替と実効Reasoningを再現する。
import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiAccount } from "../../extension/backends/pi/PiAccount";
import { createBuiltinUiRegistry } from "../../extension/ui-contributions/builtinContributions";
import { initialState, type ChatState } from "../../shared/chatState";
import type { UiMessage } from "../../shared/messages";
import { ComposerSettings } from "../../webview/chat/composer/ComposerSettings";
import "../../webview/chat/chat.css";
import { piLiveCatalog } from "../../../tests/fixtures/piLiveCatalog";

/** 認証やネットワークを使用せず、SDKのモデル切替・clampだけを模す。 */
function createAccount(hidden: boolean, noMetadata: boolean) {
	const models = [
		{
			provider: "openai-codex",
			id: "max-model",
			name: "Codex Max Model",
			api: "openai-codex-responses",
			levels: ["off", "minimal", "low", "high", "max"],
		},
		{
			provider: "openai-codex",
			id: "small",
			name: "Codex Small",
			api: "openai-codex-responses",
			levels: ["off", "minimal", "low", "high"],
		},
		{
			provider: "openai-codex",
			id: "spark",
			name: "Spark",
			api: "openai-codex-responses",
			levels: ["low", "high"],
		},
		{
			provider: "openai-codex",
			id: "hidden",
			name: "Static hidden",
			api: "openai-codex-responses",
			levels: ["low", "high"],
		},
		{
			provider: "anthropic",
			id: "claude",
			name: "Claude",
			api: "anthropic-messages",
			levels: ["low", "high"],
		},
		{
			provider: "google",
			id: "gemini",
			name: "Gemini",
			api: "google-generative-ai",
			levels: ["low", "high"],
		},
		{
			provider: "local",
			id: "local",
			name: "Local OpenAI-compatible model with a long descriptive name",
			api: "openai-completions",
			levels: ["off"],
		},
	];
	const session = {
		model: hidden
			? models.find((model) => model.id === "hidden")!
			: models[0]!,
		thinkingLevel: "high",
		getAvailableThinkingLevels: () => session.model.levels,
		setThinkingLevel: (value: string) => {
			session.thinkingLevel = value;
		},
		setModel: (model: (typeof models)[number]) => {
			session.model = model;
			if (!model.levels.includes(session.thinkingLevel)) {
				session.thinkingLevel = model.levels.at(-1)!;
			}
			return Promise.resolve();
		},
	};
	const account = new PiAccount(
		{
			getAvailable: () => Promise.resolve(models),
			getAvailableSnapshot: () => models,
			getProviderAuthStatus: () => ({ configured: true }),
			isUsingOAuth: () => true,
		} as unknown as ModelRuntime,
		session as unknown as AgentSession,
	);
	// metadataだけを固定し、候補と設定操作は本物のHostへ委譲する。
	account.catalog.snapshot = (provider) => {
		if (provider !== "openai-codex") {
			return undefined;
		}
		return noMetadata ? null : piLiveCatalog;
	};
	account.catalog.refresh = () => Promise.resolve();
	return account;
}

/** provider判定はStoryのHost役だけが行い、本体Rendererは宣言を描画する。 */
function ProviderControlsStory({
	hidden = false,
	noMetadata = false,
}: {
	hidden?: boolean;
	noMetadata?: boolean;
}) {
	const [account] = useState(() => createAccount(hidden, noMetadata));
	const [registry] = useState(createBuiltinUiRegistry);
	const [state, setState] = useState<ChatState>(() => ({
		...initialState(),
		...account.snapshot(),
		sessionId: "pi-controls-story",
		quota: [
			{
				label: "5h",
				remaining: 68,
				detail: "リセット: 2026-09-22T10:00:00Z",
			},
			{
				label: "Weekly",
				remaining: 82,
				detail: "リセット: 2026-09-28T10:00:00Z",
			},
		],
	}));
	const [last, setLast] = useState<UiMessage>();
	useEffect(() => {
		const abort = new AbortController();
		void account
			.refreshCatalog(abort.signal)
			.then(() => {
				if (!abort.signal.aborted) {
					setState((current) => ({
						...current,
						...account.snapshot(),
					}));
				}
			})
			.catch(() => undefined);
		return () => abort.abort();
	}, [account]);
	const contributions = registry.resolve(state, {
		backend: "pi",
		provider: state.piProviderControls?.provider ?? null,
		capabilities: state.configOptions.map((option) => option.id),
	});
	/** Hostの完了通知で選択値を更新する。 */
	const send = (message: UiMessage) => {
		setLast(message);
		if (message.type === "config/set") {
			void account
				.configure(
					message.configId,
					message.value,
					new AbortController().signal,
				)
				.then(() =>
					setState((current) => ({
						...current,
						...account.snapshot(),
						quota:
							message.configId === "provider"
								? null
								: current.quota,
					})),
				);
		}
	};
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
				aria-label="実効設定"
				className="mt-[12px] block text-[11px] [overflow-wrap:anywhere]"
			>
				{JSON.stringify(state.piProviderControls)}
			</output>
			<output
				aria-label="最後の要求"
				className="mt-[12px] block text-[11px] [overflow-wrap:anywhere]"
			>
				{last ? JSON.stringify(last) : "未操作"}
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
type Story = StoryObj<typeof meta>;
export const Connected: Story = {};
export const HiddenHistory: Story = { args: { hidden: true } };
export const NoMetadata: Story = { args: { noMetadata: true } };
