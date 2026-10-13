// Pi の利用可能な設定とメタデータ取得失敗時の設定を分けて表示する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import PiProviderControlsStory from "./PiProviderControlsStory.svelte";

const meta = {
	title: "Chat/Pi Provider Controls",
	component: PiProviderControlsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PiProviderControlsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connected: Story = {};
export const NoMetadata: Story = { args: { noMetadata: true } };
