import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SymbolStory from "./SymbolStory.svelte";

const meta = {
	title: "Chat/Composer Symbols",
	component: SymbolStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SymbolStory>;

export default meta;

/** 検索から挿入・送信まで操作できるストーリー。 */
type Story = StoryObj<typeof meta>;

export const Search: Story = {};
