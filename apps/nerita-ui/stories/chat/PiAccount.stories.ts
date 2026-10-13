// Pi の認証待ち・取消・モデル変更を実チャット UI で観察する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import PiAccountStory from "./PiAccountStory.svelte";

const meta = {
	title: "Chat/PiAccount",
	component: PiAccountStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PiAccountStory>;
export default meta;
/** 認証前からモデルを選び直す操作の開始状態。 */
type Story = StoryObj<typeof meta>;
export const Authentication: Story = {};
