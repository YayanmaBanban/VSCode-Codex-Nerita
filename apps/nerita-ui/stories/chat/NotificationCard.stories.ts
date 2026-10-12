// 通知の色指定と時間経過をチャットの実行状態から独立して確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import NotificationStory from "./NotificationStory.svelte";
import "../../src/chat/chat.css";

const meta = {
	title: "Chat/NotificationCard",
	component: NotificationStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NotificationStory>;
export default meta;
/** 標準色と任意の背景色を比較するストーリー。 */
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const CustomBackground: Story = { args: { backgroundColor: "#28483a" } };
