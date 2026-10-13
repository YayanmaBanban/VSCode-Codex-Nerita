// Plan 完了カードの表示と選択操作を確認するストーリー。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import PlanDecisionStory from "./PlanDecisionStory.svelte";
import "../../src/chat/chat.css";

const meta = {
	title: "Chat/Plan Decision",
	component: PlanDecisionStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlanDecisionStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Completed: Story = {};
