// App Server の設定・逐次出力・承認を、本体と同じ通信契約で再現する。

import { createChatStoryBridge, type Scenario } from "./mockBridge";

/** 未実装の操作を無効にし、App Server の承認選択肢を表示する。 */
export function createAppServerBridge(scenario: Scenario) {
	const bridge = createChatStoryBridge(scenario);
	bridge.patchState(structuredClone(appServerInitialState));
	if (scenario === "streaming") {
		bridge.patchState({
			tools: structuredClone(appServerStreamingTools),
		});
	}
	if (scenario === "permission") {
		bridge.patchState({
			permissions: [
				{
					id: "permission",
					title: "コマンド実行の承認",
					cwd: "workspace with spaces",
					command: "Write-Output '確認が必要な操作'",
					fields: [
						{
							id: "reason",
							label: "理由",
							value: "作業フォルダーでの実行を確認してください。",
							display: "text",
						},
					],
					options: [
						{
							id: "accept",
							name: "今回のみ許可",
							kind: "allow_once",
						},
						{ id: "decline", name: "拒否", kind: "reject_once" },
						{
							id: "cancel",
							name: "ターンを中止",
							kind: "reject_once",
						},
					],
				},
			],
		});
	}
	return bridge;
}

/** App Server の設定と能力を再現する初期状態。 */
const appServerInitialState: Parameters<
	ReturnType<typeof createChatStoryBridge>["patchState"]
>[0] = {
	attachmentsSupported: true,
	configOptions: [
		{
			id: "model",
			name: "Model",
			currentValue: "test",
			options: [
				{ value: "test", name: "Test model" },
				{ value: "other", name: "Other model" },
			],
		},
		{
			id: "reasoning_effort",
			name: "Reasoning effort",
			currentValue: "medium",
			options: [
				{ value: "medium", name: "medium" },
				{ value: "high", name: "high" },
			],
		},
		{
			id: "mode",
			name: "Mode",
			currentValue: "read-only",
			options: [
				{ value: "read-only", name: "読み取り専用" },
				{
					value: "workspace-write",
					name: "ワークスペース内に書き込み",
				},
			],
		},
		{
			id: "service_tier",
			name: "Service tier",
			currentValue: "default",
			options: [
				{ value: "default", name: "Standard" },
				{ value: "fast", name: "Fast" },
			],
		},
	],
	usage: { used: 15000, size: 128000 },
	quota: [{ label: "5時間", remaining: 75, detail: "翌日午前0時にリセット" }],
	sessionCapabilities: {
		list: true,
		load: true,
		fork: true,
		delete: true,
		archive: true,
		rename: true,
		unarchive: true,
	},
};

/** 逐次出力中の推論・コマンド・変更の状態。 */
const appServerStreamingTools: NonNullable<
	Parameters<
		ReturnType<typeof createChatStoryBridge>["patchState"]
	>[0]["tools"]
> = [
	{
		id: "reason",
		runId: "story-run",
		title: "推論",
		kind: "think",
		status: "in_progress",
		paths: [],
		content: [
			{
				type: "content",
				content: {
					type: "text",
					text: "設定の依存関係を確認しています。\n\n変更範囲を確認してから検証します。",
				},
			},
		],
	},
	{
		id: "command",
		runId: "story-run",
		title: "pnpm.cmd check",
		cwd: "workspace with spaces",
		kind: "execute",
		status: "in_progress",
		paths: [],
		rawOutput: {
			formatted_output: "型検査を実行中...\nLint: OK\n",
		},
	},
	{
		id: "edit",
		runId: "story-run",
		title: "ファイル変更",
		kind: "edit",
		status: "in_progress",
		paths: ["src/config.ts"],
		content: [
			{
				type: "unifiedDiff",
				path: "src/config.ts",
				diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1 +1 @@\n-export const enabled = false;\n+export const enabled = true;",
			},
		],
	},
];
