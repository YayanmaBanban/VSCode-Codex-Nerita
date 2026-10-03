// 製品のコンポーネントを使い、ツールごとの表示と完了時の開閉を再現する。

import { type SetStateAction, type Dispatch, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { initialState, type ToolSummary } from "@nerita/shared/chatState";
import { type UiMessage } from "@nerita/shared/messages";
import type { AsyncTask } from "@nerita/shared/asyncTask";
import { Activity } from "../../../src/chat/Activity";
import { ToolCard } from "../../../src/chat/tools/ToolCard";
import { ToolOutputBridge } from "../../../src/chat/tools/ToolOutputView";
import { createStoryBridge } from "../mocks/storyBridge";
import "../../../src/chat/chat.css";

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

/** 同じ ID のツールを完了状態へ更新し、各カードの開閉が独立していることを確認する。 */
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
			{<CompleteToolsButton setTasks={setTasks} setTools={setTools} />}
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
/** ツールカードの表示と状態変化を確認するストーリーの型。 */
type Story = StoryObj<typeof meta>;
export const Running: Story = {};
export const Background: Story = { args: { background: true } };

/** 完了通知によるツールと非同期タスクの状態変化を再現する。 */
function CompleteToolsButton({
	setTasks,
	setTools,
}: {
	setTasks: Dispatch<SetStateAction<AsyncTask[]>>;
	setTools: Dispatch<SetStateAction<ToolSummary[]>>;
}) {
	return (
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
	);
}

/** 出力取得の要求に手動で応答し、取得待ちと取得後の表示を再現する。 */
function LargeOutputStory() {
	const [completed, setCompleted] = useState(false);
	const [bridge] = useState(() => createStoryBridge(initialState()));
	return (
		<main style={{ padding: 16 }}>
			<button onClick={() => setCompleted(true)}>完了通知を受信</button>
			<button
				onClick={() => {
					const request = [...bridge.sent]
						.reverse()
						.find((message) => message.type === "tool/output");
					if (request?.type !== "tool/output") {
						return;
					}
					bridge.emit({
						type: "tool/outputResult",
						requestId: request.requestId,
						outputRef: request.outputRef,
						text:
							request.offset === 0
								? "先頭の詳細出力\n日本語と絵文字 🐈\n".repeat(
										1000,
									)
								: "次の詳細出力\nFAIL: 末尾エラー",
						offset: request.offset,
						nextOffset: request.offset === 0 ? 65535 : 65600,
						eof: request.offset !== 0,
					});
				}}
			>
				出力応答を受信
			</button>
			<ToolOutputBridge value={bridge}>
				<ToolCard
					tool={{
						id: "large",
						kind: "execute",
						title: "Get-Content ./logs/very-long-directory-name/large-output-with-japanese-text.log",
						cwd: "./workspace/project",
						paths: [],
						status: completed ? "completed" : "in_progress",
						output: {
							preview:
								"出力開始\nChecking types...\n\n… 出力を省略 …\n\nFAIL: 末尾エラー",
							truncated: true,
							outputRef: "large-output",
							totalBytes: 1600000,
						},
					}}
				/>
			</ToolOutputBridge>
		</main>
	);
}

export const LargeOutput: Story = { render: () => <LargeOutputStory /> };

/** Host が非公開情報を除去した構造化結果を模したデータで、要約と省略表示を確認する。 */
export const StructuredResult: Story = {
	render: () => (
		<main style={{ padding: 16 }}>
			<ToolCard
				tool={{
					id: "structured",
					title: "項目数を取得",
					kind: "other",
					status: "completed",
					paths: [],
					resultDisplay: {
						source: "structuredContent",
						omitted: true,
					},
					content: [
						{
							type: "content",
							content: {
								type: "text",
								text: '{\n  "count": 3,\n  "html": "<script>window.unsafeResult = true</script>",\n  "private": "[非公開]"\n}\n[表示上限または非公開情報のため、一部を省略しました。]',
							},
						},
					],
				}}
			/>
		</main>
	),
};
