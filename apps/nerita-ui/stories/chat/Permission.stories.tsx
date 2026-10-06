// 長いコマンドと詳細を、チャットの固定ヘッダーなしで確認する。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity } from "../../src/chat/Activity";
import { initialState } from "@nerita/shared/chatState";
import "../../src/chat/chat.css";

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
							kind: "allow",
						},
						{ id: "decline", name: "拒否", kind: "deny" },
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

/** MXC 非互換時の Host 実行を、論理クラスと4つの承認範囲で表示する。 */
export const NativePnpm: Story = {
	args: {
		state: {
			...initialState(),
			sessionId: "session",
			runId: "run",
			permissions: [
				{
					id: "native-pnpm",
					title: "Pi: pnpm の実行承認",
					cwd: "projects/current",
					command: "pnpm install",
					fields: [
						{
							id: "tool",
							label: "論理ツール",
							value: "pnpm",
							display: "text",
						},
						{
							id: "class",
							label: "コマンドクラス",
							value: "installation-network",
							display: "text",
						},
						{
							id: "reason",
							label: "ホスト実行が必要な理由",
							value: "ネイティブ版 pnpm は MXC 内の DOS パス正規化に対応していません。",
							display: "text",
						},
						{
							id: "route",
							label: "実行経路",
							value: "ホスト（Sandbox 外）。ファイルと通信は OS ユーザーの権限で実行されます。",
							display: "text",
						},
					],
					options: [
						{ id: "accept", name: "今回だけ", kind: "allow" },
						{
							id: "accept-session",
							name: "セッション中",
							kind: "allow",
						},
						{
							id: "accept-workspace",
							name: "このワークスペース",
							kind: "allow",
						},
						{ id: "cancel", name: "キャンセル", kind: "abort" },
					],
				},
			],
		},
	},
};
