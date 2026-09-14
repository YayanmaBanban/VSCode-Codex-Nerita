// ツールの専用表示と完了時の開閉を、実コンポーネントで再現する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ToolSummary } from "../../../shared/messages";
import { ToolCard } from "./ToolCard";
import "../chat.css";

const initialTools: ToolSummary[] = [
	{
		id: "guardian",
		title: "Guardian Review",
		status: "in_progress",
		paths: [],
		rawInput: {
			review: { status: "inProgress" },
			action: {
				command: "pnpm.cmd --version",
				cwd: "D:/workspace/project",
			},
		},
	},
	{
		id: "edit",
		title: "Editing files",
		status: "in_progress",
		paths: ["hello-world.bat"],
		content: [
			{
				type: "diff",
				path: "hello-world.bat",
				oldText: "@echo off\necho hello",
				newText: "@echo off\necho hello world\npause",
			},
		],
	},
	{
		id: "generic",
		title: "Run command",
		status: "in_progress",
		paths: [],
		content: [
			{
				type: "content",
				content: { type: "text", text: "実行結果を待っています。" },
			},
		],
		rawInput: { command: "pnpm.cmd --version" },
	},
	{
		id: "guardian-2",
		title: "Guardian Review",
		status: "failed",
		paths: [],
		content: [
			{
				type: "content",
				content: {
					type: "text",
					text: "審査結果を取得できませんでした。",
				},
			},
		],
	},
];

/** 同一 ID の完了通知を再現し、開閉状態の独立性を確認する。 */
function ToolCardsStory() {
	const [tools, setTools] = useState(initialTools);
	return (
		<main style={{ padding: 16 }}>
			<button
				onClick={() =>
					setTools((current) =>
						current.map((tool) =>
							tool.status === "failed"
								? tool
								: {
										...tool,
										status: "completed",
										...(tool.id === "guardian"
											? {
													rawOutput: {
														review: {
															status: "approved",
															riskLevel: "low",
															userAuthorization:
																"high",
															rationale:
																"バージョン確認のため承認しました。",
														},
													},
												}
											: {}),
									},
						),
					)
				}
			>
				完了通知を受信
			</button>
			{tools.map((tool) => (
				<ToolCard key={tool.id} tool={tool} />
			))}
		</main>
	);
}
const meta = {
	title: "Chat/Tool Cards",
	component: ToolCardsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ToolCardsStory>;
export default meta;
/** 全種類のツールカードを表示する Story。 */
type Story = StoryObj<typeof meta>;
export const Running: Story = {};
