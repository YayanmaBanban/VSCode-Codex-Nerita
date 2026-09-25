// 長いコマンドと詳細を、チャットの固定ヘッダーなしで確認する。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity } from "../../webview/chat/Activity";
import { initialState } from "../../shared/chatState";
import "../../webview/chat/chat.css";

const command = Array.from(
	{ length: 20 },
	(_, index) =>
		`Write-Output '${index + 1}: ${"長いコマンドの内容 ".repeat(12)}'`,
).join("\n");
const meta = {
	title: "Chat/Permission",
	component: Activity,
	parameters: { layout: "padded" },
	args: {
		state: {
			...initialState(),
			sessionId: "session",
			runId: "run",
			permissions: [
				{
					id: "long",
					title: "Pi: powershell の実行承認",
					cwd: "workspace/長いフォルダー名/project",
					command,
					fields: [
						{
							id: "scope",
							label: "実行範囲",
							value: "Shell Sandbox",
							display: "text",
						},
					],
					details: [
						{
							id: "argv",
							label: "実行argv",
							value: JSON.stringify(
								["powershell.exe", "-Command", command],
								null,
								2,
							),
							display: "code",
						},
						{
							id: "timeout",
							label: "制限時間",
							value: "10000 ms",
							display: "text",
						},
					],
					options: [
						{
							id: "accept",
							name: "今回のみ許可",
							kind: "allow_once",
						},
						{ id: "decline", name: "拒否", kind: "reject_once" },
					],
				},
			],
		},
		send: () => {},
	},
} satisfies Meta<typeof Activity>;
export default meta;
/** 長文のスクロールと詳細の開閉を確認する状態。 */
type Story = StoryObj<typeof meta>;
export const LongCommand: Story = {};
