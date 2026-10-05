// 製品のコンポーネントを使い、ツールごとの表示と完了時の開閉を再現する。

import { type SetStateAction, type Dispatch, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, within, waitFor } from "storybook/test";
import { initialState, type ToolSummary } from "@nerita/shared/chatState";
import { type UiMessage } from "@nerita/shared/messages";
import type { AsyncTask } from "@nerita/shared/asyncTask";
import { Activity } from "../../../src/chat/Activity";
import { ToolCard } from "../../../src/chat/tools/ToolCard";
import { useFollowConversation } from "../../../src/chat/messages/useFollowConversation";
import { ToolOutputBridge } from "../../../src/chat/tools/ToolOutputView";
import { createStoryBridge } from "../mocks/storyBridge";
import { commandTools } from "../fixtures/toolCommands";
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
function ToolCardsStory({
	background = false,
	commands = false,
}: {
	background?: boolean;
	commands?: boolean;
}) {
	const [tools, setTools] = useState(() => {
		const source = commands ? commandTools : initialTools;
		if (!background) {
			return source;
		}
		return source
			.filter((tool) => tool.id === "execute")
			.map((tool) => ({ ...tool, status: "completed" as const }));
	});
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
export const CommandTitles: Story = { args: { commands: true } };

/** 開いた実行カードだけを展開したまま保ち、閉じたカードは完了後も閉じておく。 */
export const CompletionPreservesExpansion: Story = {
	args: { commands: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const codex = canvas.getByRole("button", {
			name: /^Get-Content/,
			expanded: false,
		});
		const pi = canvas.getByRole("button", {
			name: /^Get-Location/,
			expanded: false,
		});
		const closed = canvas.getByRole("button", {
			name: /^pnpm.cmd check/,
			expanded: false,
		});
		await userEvent.click(codex);
		await userEvent.click(pi);
		await expect(codex).toHaveAttribute("aria-expanded", "true");
		await expect(pi).toHaveAttribute("aria-expanded", "true");
		await userEvent.click(
			canvas.getByRole("button", { name: "完了通知を受信" }),
		);
		await waitFor(async () => {
			await expect(codex).toHaveAttribute("aria-expanded", "true");
			await expect(pi).toHaveAttribute("aria-expanded", "true");
			await expect(closed).toHaveAttribute("aria-expanded", "false");
		});
		await expect(canvas.getAllByRole("img", { name: "完了" })).toHaveLength(
			3,
		);
		await userEvent.click(codex);
		await expect(codex).toHaveAttribute("aria-expanded", "false");
	},
};

/** 会話末尾で長いカードを開き、展開前後の見出し位置を確認する。 */
function ScrollExpansionStory() {
	const container = useRef<HTMLDivElement>(null);
	useFollowConversation(container, "tool-scroll", false);
	return (
		<div ref={container} className="h-[400px] overflow-y-auto px-5 py-4">
			<div className="h-[480px]">過去の会話</div>
			{Array.from({ length: 6 }, (_, index) => (
				<ToolCard
					key={index}
					tool={{
						id: `scroll-${index}`,
						title: `スクロール確認 ${index + 1}`,
						kind: index === 1 ? "think" : "execute",
						status: "completed",
						paths: [],
						...(index === 1
							? {
									content: [
										{
											type: "content",
											content: {
												type: "text",
												text: "推論の内容\n".repeat(40),
											},
										},
									],
								}
							: {
									output: {
										preview: "実行結果\n".repeat(40),
										truncated: false,
									},
								}),
					}}
				/>
			))}
		</div>
	);
}

export const ScrollExpansion: Story = {
	render: () => <ScrollExpansionStory />,
};

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
								"出力開始\nChecking types...\n\n… 18,420文字を省略 …\n\nFAIL: 末尾エラー",
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

/** 詳細出力の開閉・範囲移動と、表示中の範囲だけをコピーする契約を確認する。 */
export const OutputControls: Story = {
	render: () => <LargeOutputStory />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue(
			undefined,
		);
		try {
			await userEvent.click(
				canvas.getByRole("button", {
					name: /^Get-Content/,
					expanded: false,
				}),
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "出力をコピー" }),
			);
			await expect(copy).toHaveBeenLastCalledWith(
				"出力開始\nChecking types...\n\n… 18,420文字を省略 …\n\nFAIL: 末尾エラー",
			);
			const disclosure = canvas.getByRole("button", { name: "詳細出力" });
			await userEvent.click(disclosure);
			const detail = await canvas.findByRole("region", {
				name: "詳細出力",
			});
			const range = within(detail);
			const copyButton = range.getByRole("button", {
				name: "出力をコピー",
			});
			const previous = range.getByRole("button", {
				name: "前の範囲を表示",
			});
			const next = range.getByRole("button", { name: "次の範囲を表示" });
			await expect(copyButton).toBeDisabled();
			await expect(previous).toBeDisabled();
			await userEvent.click(
				canvas.getByRole("button", { name: "出力応答を受信" }),
			);
			await userEvent.click(copyButton);
			await expect(copy).toHaveBeenLastCalledWith(
				"先頭の詳細出力\n日本語と絵文字 🐈\n".repeat(1000),
			);
			await userEvent.click(next);
			await userEvent.click(
				canvas.getByRole("button", { name: "出力応答を受信" }),
			);
			await expect(next).toBeDisabled();
			await userEvent.click(copyButton);
			await expect(copy).toHaveBeenLastCalledWith(
				"次の詳細出力\nFAIL: 末尾エラー",
			);
			await userEvent.click(previous);
			await userEvent.click(
				canvas.getByRole("button", { name: "出力応答を受信" }),
			);
			await expect(previous).toBeDisabled();
			copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
			await userEvent.click(copyButton);
			await expect(copyButton).toHaveAttribute(
				"data-copy-result",
				"error",
			);
			await userEvent.click(copyButton);
			await expect(copyButton).toHaveAttribute(
				"data-copy-result",
				"success",
			);
			await userEvent.click(disclosure);
			await expect(
				canvas.queryByRole("region", { name: "詳細出力" }),
			).not.toBeInTheDocument();
			await expect(disclosure).toHaveAttribute("aria-expanded", "false");
		} finally {
			copy.mockRestore();
		}
	},
};

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

/** 遠隔処理の応答喪失は結果不明と表示し、再実行を促す操作を置かない。 */
export const UnknownResult: Story = {
	render: () => (
		<main style={{ padding: 16 }}>
			<ToolCard
				tool={{
					id: "unknown-result",
					title: "遠隔の項目を更新",
					kind: "other",
					status: "unknown",
					paths: [],
					resultDisplay: { source: "content", omitted: false },
					content: [
						{
							type: "content",
							content: {
								type: "text",
								text: "MCP 操作の結果は不明です。遠隔処理が完了した可能性があるため、再実行前に結果を確認してください。",
							},
						},
					],
				}}
			/>
		</main>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText("結果不明", { exact: true }),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", {
				name: /^遠隔の項目を更新/,
				expanded: false,
			}),
		);
		await waitFor(async () => {
			await expect(
				canvas.getByText(/遠隔処理が完了した可能性/),
			).toBeVisible();
		});
		await expect(
			canvas.queryByRole("button", { name: /再実行|停止/ }),
		).not.toBeInTheDocument();
	},
};
