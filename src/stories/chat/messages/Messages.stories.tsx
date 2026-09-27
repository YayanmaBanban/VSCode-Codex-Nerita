// メッセージ内の参照リンクと Markdown の表示を確認する。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Messages } from "../../../webview/chat/messages/Messages";
import "../../../webview/chat/chat.css";

const meta = {
	title: "Chat/Messages",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
/** メッセージ表示の確認用ストーリー。 */
type Story = StoryObj<typeof meta>;

/** 長いファイル名と Markdown・コードに囲まれた参照を狭幅で確認する。 */
export const References: Story = {
	render: () => {
		const path = {
			kind: "file" as const,
			name: "とても長いファイル名を持つ日本語のメッセージコンポーネント.tsx",
			path: "D:/workspace/long.tsx",
			uri: "file:///D:/workspace/long.tsx",
		};
		const text = `**確認対象** ${path.path}\nコード内: \`${path.path}\``;
		const references = [
			text.indexOf(path.path),
			text.lastIndexOf(path.path),
		].map((offset) => ({ offset, path }));
		return (
			<main className="p-[14px]">
				<Messages
					busy={false}
					send={() => {}}
					messages={[
						{ id: "user", role: "user", text, references },
						{ id: "answer", role: "assistant", text, references },
					]}
				/>
			</main>
		);
	},
};
