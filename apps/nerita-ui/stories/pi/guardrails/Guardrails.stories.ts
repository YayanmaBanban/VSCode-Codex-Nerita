// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import GuardrailsPreview from "./GuardrailsPreview.svelte";
const meta = {
	title: "Pi/Guardrails",
	component: GuardrailsPreview,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GuardrailsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
