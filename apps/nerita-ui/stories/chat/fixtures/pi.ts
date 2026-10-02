// Pi の会話とツールの表示状態。送信内容や承認結果から状態を導出しない。

import { initialState, type ChatState } from "@nerita/shared/chatState";
import { createBuiltinUiRegistry } from "../../../../../apps/vscode-nerita/src/extension/ui-contributions/builtinContributions";

/** 独立した Pi の表示状態を作る。 */
export function piState(
	run: ChatState["run"] = "idle",
	showTools = false,
): ChatState {
	const state: ChatState = {
		...initialState(),
		connection: "ready",
		sessionId: "pi-story",
		sessionTitle: "Pi",
		cwd: "workspace/project",
		attachmentsSupported: false,
		run,
		configOptions: [
			{
				id: "model",
				name: "Pi Model",
				currentValue: "local/smoke",
				options: [],
			},
		],
	};
	state.uiContributions = createBuiltinUiRegistry().resolve(state, {
		backend: "pi",
		provider: "local",
		capabilities: ["model"],
	});
	if (run !== "idle") {
		state.runId = "pi-story-run";
		state.messages = [
			{
				id: "pi-user",
				role: "user",
				order: 1,
				text: "ファイルを確認してください",
			},
			{
				id: "pi-answer",
				role: "assistant",
				order: 4,
				text: "Piからの応答です。ワークスペースのファイルを読み取り、内容を確認しました。",
				streaming: run === "running",
			},
		];
	}
	if (run === "completed") {
		state.usage = { used: 60000, size: 200000 };
	}
	if (showTools) {
		state.tools = structuredClone(samplePiTools);
	}
	return state;
}

/** 同じ親子関係の実行通知と、結果本文を持たない保存要約を再現する。 */
export function piNestedState(summaryOnly = false): ChatState {
	const state = piState(summaryOnly ? "completed" : "running");
	const status = summaryOnly ? "completed" : "in_progress";
	state.messages = [state.messages[0]!];
	state.tools = [
		{
			id: "outer",
			runId: "pi-story-run",
			order: 2,
			title: "複数のファイルを確認",
			kind: "list",
			paths: [],
			status,
			...(summaryOnly ? { nestedCallsIncomplete: true } : {}),
		},
		{
			id: "outer/1",
			parentToolCallId: "outer",
			runId: "pi-story-run",
			order: 3,
			title: "ファイルを読む: src/長い名前のフォルダー/child.txt",
			kind: "read",
			paths: ["src/長い名前のフォルダー/child.txt"],
			status,
			rawInput: { path: "src/長い名前のフォルダー/child.txt" },
			...(summaryOnly ? { summaryOnly: true } : {}),
			content: summaryOnly
				? []
				: [
						{
							type: "content",
							content: { type: "text", text: "LIVE_ONLY_RESULT" },
						},
					],
		},
		{
			id: "outer/1/1",
			parentToolCallId: "outer/1",
			runId: "pi-story-run",
			order: 4,
			title: "ファイルを書き込む: child.txt",
			kind: "edit",
			paths: [],
			status: "failed",
			...(summaryOnly
				? { summaryOnly: true, omittedArgumentBytes: 8193 }
				: { rawInput: { path: "child.txt" } }),
			content: [
				{
					type: "content",
					content: { type: "text", text: "操作が拒否されました。" },
				},
			],
		},
		{
			id: "outer/2",
			parentToolCallId: "outer",
			runId: "pi-story-run",
			order: 5,
			title: "未完了の読み取り",
			kind: "read",
			paths: [],
			status: summaryOnly ? "unfinished" : "in_progress",
			...(summaryOnly ? { summaryOnly: true } : {}),
		},
	];
	return state;
}

/** 完了した一覧・読取りツールの表示を再現する。 */
const samplePiTools: ChatState["tools"] = [
	{
		id: "pi-list",
		runId: "pi-story-run",
		order: 2,
		title: "フォルダーを確認: src",
		kind: "list",
		status: "completed",
		paths: ["src"],
		content: [
			{
				type: "content",
				content: {
					type: "text",
					text: "extension/\nshared/\nwebview/",
				},
			},
		],
	},
	{
		id: "pi-read",
		runId: "pi-story-run",
		order: 3,
		title: "ファイルを読む: src/長いディレクトリ名の折り返しを確認するためのフォルダー/README.md",
		kind: "read",
		status: "completed",
		rawInput: { offset: 1, limit: 20 },
		paths: [
			"src/長いディレクトリ名の折り返しを確認するためのフォルダー/README.md",
		],
		content: [
			{
				type: "content",
				content: {
					type: "text",
					text: "# Piツール表示\n本文の表示を確認しました。\n<script>これはファイルの内容です</script>",
				},
			},
		],
	},
];
