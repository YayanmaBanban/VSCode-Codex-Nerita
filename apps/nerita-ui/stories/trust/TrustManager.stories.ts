// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import TrustPreview from "./TrustPreview.svelte";

const meta = { title: "Trust/Manager", component: TrustPreview } satisfies Meta<
	typeof TrustPreview
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
