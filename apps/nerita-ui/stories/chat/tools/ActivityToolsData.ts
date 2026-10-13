// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
import type { ToolSummary } from "@nerita/shared/chatState";

export const tools: ToolSummary[] = [
	{
		id: "think",
		title: "推論",
		kind: "think",
		status: "in_progress",
		paths: [],
		content: [
			{
				type: "content",
				content: {
					type: "text",
					text: "**Implementing file move mapping**",
				},
			},
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
		searchLabel: "React scroll & resize",
	},
	{
		id: "url",
		searchLabel: "https://example.com/page?q=1",
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
		searchLabel: "https://example.com/normalized",
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
		status: "in_progress",
		paths: [],
	},
];
