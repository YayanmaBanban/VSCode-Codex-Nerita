// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import TimelineTimelineStory from "./TimelineTimelineStory.svelte";
const meta = {
	title: "Chat/Timeline",
	component: TimelineTimelineStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TimelineTimelineStory>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const History: Story = {};
