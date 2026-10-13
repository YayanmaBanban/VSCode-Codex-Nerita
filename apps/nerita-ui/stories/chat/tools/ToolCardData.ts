// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
import type { ToolSummary } from "@nerita/shared/chatState";

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
