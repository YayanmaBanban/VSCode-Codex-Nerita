// ツールの専用表示と完了時の開閉を、実コンポーネントで再現する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	initialState,
	type ToolSummary,
	type UiMessage,
} from "../../../shared/messages";
import type { AsyncTask } from "../../../shared/asyncTask";
import { Activity } from "../Activity";
import "../chat.css";

const initialTools: ToolSummary[] = [
	{
		id: "guardian",
		title: "コマンドの安全性を確認",
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

/** 同一 ID の完了通知を再現し、開閉状態の独立性を確認する。 */
function ToolCardsStory({ background = false }: { background?: boolean }) {
	const [tools, setTools] = useState(() =>
		background
			? initialTools
					.filter((tool) => tool.id === "execute")
					.map((tool) => ({ ...tool, status: "completed" as const }))
			: initialTools,
	);
	const [asyncTasks, setTasks] = useState<AsyncTask[]>([
		{
			asyncTaskId: "different-task-id",
			toolCallId: "execute",
			state: "running",
			canStop: true,
		},
	]);
	const [request, setRequest] = useState<UiMessage>();
	return (
		<main style={{ padding: 16 }}>
			<button
				onClick={() => {
					setTasks((tasks) =>
						tasks.map((task) => ({
							...task,
							state: "completed",
							canStop: false,
						})),
					);
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
					);
				}}
			>
				完了通知を受信
			</button>
			<Activity
				state={{
					...initialState(),
					connection: "ready",
					sessionId: "session-test",
					runId: "run-test",
					run: background ? "completed" : "running",
					tools,
					asyncTasks,
				}}
				send={(message) => {
					setRequest(message);
					if (message.type === "execution/stop") {
						setTasks((tasks) =>
							tasks.map((task) => ({
								...task,
								state: background ? "stopped" : "failed",
								canStop: false,
							})),
						);
						setTools((current) =>
							current.map((tool) =>
								tool.id === message.toolId
									? {
											...tool,
											status: "failed",
										}
									: tool,
							),
						);
					}
				}}
			/>
			<output aria-label="送信した要求">
				{request && JSON.stringify(request)}
			</output>
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
export const Background: Story = { args: { background: true } };
