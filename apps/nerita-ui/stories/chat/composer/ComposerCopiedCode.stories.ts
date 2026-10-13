import type { Meta, StoryObj } from "@storybook/svelte-vite";
import CopiedCodeStory from "./CopiedCodeStory.svelte";

const meta = {
	title: "Chat/Composer Copied Code",
	component: CopiedCodeStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CopiedCodeStory>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 通常のコピーで記録したコードの貼り付けを再現する。 */
export const Ready: Story = {};
