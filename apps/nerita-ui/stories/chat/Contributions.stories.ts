// Host の表示条件と通信契約を使い、バックエンド別の拡張設定を表示する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import ContributionStory from "./ContributionPreview.svelte";

const meta = {
	title: "Chat/Contributions",
	component: ContributionStory,
	parameters: { layout: "fullscreen" },
	args: { backend: "pi", provider: "openai" },
} satisfies Meta<typeof ContributionStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CodexAppServer: Story = { args: { backend: "codex" } };
export const PiCodex: Story = {};
export const PiAnthropic: Story = { args: { provider: "anthropic" } };
export const PiGoogle: Story = { args: { provider: "google" } };
export const PiLocal: Story = { args: { provider: "local" } };
