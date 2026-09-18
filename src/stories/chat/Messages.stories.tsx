// 長文の逐次表示、項目完了、後続の追記を独立して再現する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Messages } from "../../webview/chat/Messages";
import "../../webview/chat/chat.css";

const text = "長い回答を確認します。".repeat(30);

/** ターンを継続したまま、本文の完了と追記を切り替える。 */
function MessagesStory() {
	const [streaming, setStreaming] = useState(false);
	const [suffix, setSuffix] = useState("");
	return (
		<main className="p-[14px]">
			<button onClick={() => setStreaming(true)}>書き込み開始</button>
			<button onClick={() => setStreaming(false)}>本文完了</button>
			<button onClick={() => setSuffix("追加の本文です。")}>追記</button>
			<Messages
				busy
				messages={[
					{ id: "user", role: "user", text: "長文を表示" },
					{
						id: "answer",
						role: "assistant",
						text: text + suffix,
						streaming,
					},
				]}
			/>
		</main>
	);
}

const meta = {
	title: "Chat/Messages",
	component: MessagesStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MessagesStory>;
export default meta;
/** 長文表示の時間制御用Story。 */
type Story = StoryObj<typeof meta>;
export const LongText: Story = {};
