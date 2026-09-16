// 通知の色指定と時間経過をチャットの実行状態から独立して確認する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationCard } from "../../webview/chat/NotificationCard";
import "../../webview/chat/chat.css";

/** 閉じる操作と自動消去を実コンポーネントで観察する。 */
function NotificationStory({ backgroundColor }: { backgroundColor?: string }) {
	const [open, setOpen] = useState(true);
	return (
		<div className="pt-4">
			{open && (
				<NotificationCard
					backgroundColor={backgroundColor}
					onClose={() => setOpen(false)}
				>
					フォローアップを送信しました。
				</NotificationCard>
			)}
		</div>
	);
}
const meta = {
	title: "Chat/NotificationCard",
	component: NotificationStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NotificationStory>;
export default meta;
/** 標準色と任意の背景色を比較するStory。 */
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const CustomBackground: Story = { args: { backgroundColor: "#28483a" } };
