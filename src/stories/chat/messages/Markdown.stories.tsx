// 通常メッセージのMarkdownと、ツールのJSON表示を同じ画面で確認する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Messages } from "../../../webview/chat/messages/Messages";
import { ToolCard } from "../../../webview/chat/tools/ToolCard";
import "../../../webview/chat/chat.css";

const markdown = [
	"## 変更内容",
	"**太字**と*斜体*、~~取り消し~~、`inline code`を表示します。\n改行も保持します。",
	"- 項目A\n  - 子項目\n- 項目B",
	"1. 確認する\n2. 実行する",
	"> 引用した説明です。",
	"- [x] 完了\n- [ ] 未完了",
	"| 項目 | 状態 |\n| --- | --- |\n| Markdown | 対応済み |",
	"[ドキュメント](https://example.com/docs)",
	"[Code-Implementation.md](D:/User/Desktop/vscode-codex-acp/.agents/docs/Code-Implementation.md)",
	"[AGENTS.md](file:///D:/User/Desktop/vscode-codex-acp/AGENTS.md)",
	"[日本語](<D:/workspace/日本語 sample.md>)",
	"[コマンド](command:workbench.action.closeWindow)",
	'```ts\nconst message = "<strong>文字列</strong>";\nconst longPath = "D:/workspace/project/very/long/path/to/source/file.ts";\n```',
	'<b>HTMLは文字列</b>\n<script>alert("実行しない")</script>',
	"[無効なリンク](javascript:alert%281%29)",
].join("\n\n");

/** 書き込み中の未完コードフェンスと、完了済みの本文を切り替える。 */
function MarkdownStory() {
	const [streaming, setStreaming] = useState(false);
	const [opened, setOpened] = useState("");
	return (
		<main className="p-[14px]">
			<button onClick={() => setStreaming(true)}>途中の本文</button>
			<button onClick={() => setStreaming(false)}>本文完了</button>
			<output hidden aria-label="開いたファイル">
				{opened}
			</output>
			<Messages
				send={(message) => {
					if (message.type === "reference/open") {
						setOpened(message.uri);
					}
				}}
				busy={streaming}
				messages={[
					{
						id: "user",
						role: "user",
						text: "**Markdown**で説明してください。",
						order: 0,
					},
					{
						id: "answer",
						role: "assistant",
						text: streaming
							? "## 書き込み中\n\n```ts\nconst partial = true;"
							: markdown,
						streaming,
						order: 1,
					},
				]}
				tools={[
					{
						id: "raw",
						title: "未対応ツール",
						status: "in_progress",
						paths: [],
						rawOutput: { text: "**これはJSONのまま**" },
						order: 2,
					},
				]}
				renderTool={(tool) => <ToolCard key={tool.id} tool={tool} />}
			/>
		</main>
	);
}

const meta = {
	title: "Chat/Markdown",
	component: MarkdownStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MarkdownStory>;
export default meta;
/** Markdownの主要構文をまとめたStory。 */
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
