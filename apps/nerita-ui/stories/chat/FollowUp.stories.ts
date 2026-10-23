// 受付待ち・失敗・再送を同じ入力欄で再現するフォローアップ専用ストーリー。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import FollowUpStory from "./FollowUpStory.svelte";

const meta = {
	title: "Chat/FollowUp",
	component: FollowUpStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FollowUpStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Success: Story = {};
export const Failure: Story = { args: { failFirst: true } };
export const NormalFailure: Story = {
	args: { failFirst: true, completed: true },
};
