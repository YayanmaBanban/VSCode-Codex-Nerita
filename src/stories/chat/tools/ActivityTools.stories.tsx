// App Server の元種別と正規化済み入力を使い、専用カードとリンク要求を確認する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { initialState, type ToolSummary } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import { Activity } from "../../../webview/chat/Activity";
import "../../../webview/chat/chat.css";

const tools: ToolSummary[] = [
	{
		id: "think",
		title: "推論",
		kind: "think",
		status: "in_progress",
		paths: [],
		content: [
			"**Implementing file move mapping**",
			{
				type: "content",
				content: {
					type: "text",
					text: "**Moving files with mappings**",
				},
			},
		],
	},
	{
		id: "image",
		title: "画像を確認",
		kind: "read",
		rawItem: { type: "imageView" },
		status: "in_progress",
		paths: ["D:\\workspace\\画像 #1.png", "images/preview.png"],
	},
	{
		id: "search",
		title: "Web検索（検索語）",
		kind: "search",
		rawItem: { type: "webSearch" },
		status: "in_progress",
		paths: [],
		rawInput: "React scroll & resize",
	},
	{
		id: "url",
		title: "Web検索（URL）",
		kind: "search",
		rawItem: { type: "webSearch" },
		status: "in_progress",
		paths: [],
		rawInput: {
			query: null,
			action: { url: "https://example.com/page?q=1" },
		},
	},
	{
		id: "flat-url",
		title: "Web検索（正規化後）",
		kind: "search",
		rawItem: { type: "webSearch" },
		status: "in_progress",
		paths: [],
		rawInput: { url: "https://example.com/normalized" },
	},
	{
		id: "mcp",
		title: "server / tool",
		kind: "other",
		rawItem: { type: "mcpToolCall" },
		status: "in_progress",
		paths: [],
	},
	{
		id: "compact",
		title: "コンテキスト圧縮",
		kind: "think",
		rawItem: { type: "contextCompaction" },
		status: "completed",
		paths: [],
	},
];

function ActivityToolsStory() {
	const [request, setRequest] = useState<UiMessage>();
	return (
		<main className="p-4">
			<Activity
				state={{ ...initialState(), cwd: "D:/workspace", tools }}
				send={setRequest}
			/>
			<output
				aria-label="送信した要求"
				className="[overflow-wrap:anywhere]"
			>
				{request && JSON.stringify(request)}
			</output>
		</main>
	);
}
const meta = {
	title: "Chat/Activity Tools",
	component: ActivityToolsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ActivityToolsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const All: Story = {};
