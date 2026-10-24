// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
import type { ToolSummary } from "@nerita/shared/chatState";
import type { StoryBridge } from "../mocks/storyBridge";

/** 要求された範囲への Host 応答を注入し、ダイアログ表示中も成功・失敗を検証する。 */
export function respondToolOutput(bridge: StoryBridge, failed = false) {
	const request = [...bridge.sent]
		.reverse()
		.find((message) => message.type === "tool/output");
	if (request?.type !== "tool/output") {
		return;
	}
	if (failed) {
		bridge.emit({
			type: "request/failed",
			requestId: request.requestId,
			error: "詳細出力を取得できませんでした。閉じて開き直すと再取得できます。",
		});
		return;
	}
	bridge.emit({
		type: "tool/outputResult",
		requestId: request.requestId,
		outputRef: request.outputRef,
		text:
			request.offset === 0
				? "先頭の詳細出力\n日本語と絵文字 🐈\n".repeat(1000)
				: "次の詳細出力\nFAIL: 末尾エラー",
		offset: request.offset,
		nextOffset: request.offset === 0 ? 65535 : 65600,
		eof: request.offset !== 0,
	});
}

export const initialTools: ToolSummary[] = [
	{
		id: "guardian",
		title: "Guardian Review",
		kind: "think",
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
		kind: "think",
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
	{
		id: "execute",
		commandOutput: "Running tests…\n✓ configuration\n✓ session",
		runId: "run-test",
		title: "pnpm.cmd test",
		kind: "execute",
		status: "in_progress",
		paths: [],
		rawInput: { command: "pnpm.cmd test", cwd: "D:/workspace/project" },
		rawOutput: {
			formatted_output: "Running tests…\n✓ configuration\n✓ session",
			exit_code: null,
		},
		content: [{ type: "terminal", terminalId: "terminal-test" }],
	},
	{
		id: "execute-pending",
		title: "端末を準備",
		kind: "execute",
		status: "pending",
		paths: [],
	},
];
