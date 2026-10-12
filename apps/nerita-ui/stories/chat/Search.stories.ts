// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SearchSearchStory from "./SearchSearchStory.svelte";
const meta = {
	title: "Chat/Search",
	component: SearchSearchStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SearchSearchStory>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const Ready: Story = {};
