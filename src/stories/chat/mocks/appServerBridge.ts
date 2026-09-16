// App Serverの設定・逐次出力・承認を、本体と同じ通信契約で再現する。
import type { Bridge } from "../../../webview/vscodeBridge";
import { createMockBridge, type Scenario } from "./mockBridge";

/** 未実装の操作を無効にし、App Server の承認選択肢を表示する。 */
export function createAppServerBridge(scenario: Scenario): Bridge {
	const bridge = createMockBridge(scenario);
	bridge.patchState({
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
		quota: [
			{ label: "5時間", remaining: 75, detail: "翌日午前0時にリセット" },
		],
		sessionCapabilities: {
			list: true,
			load: true,
			fork: true,
			delete: true,
			archive: true,
			rename: true,
			unarchive: true,
		},
	});
	if (scenario === "streaming") {
		bridge.patchState({
			tools: [
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
					cwd: "D:/workspace with spaces",
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
			],
		});
	}
	if (scenario === "permission") {
		bridge.patchState({
			permissions: [
				{
					id: "permission",
					title: "コマンド実行の承認\nWrite-Output '確認が必要な操作'\nD:/workspace with spaces\n作業フォルダーでの実行を確認してください。",
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
	return {
		subscribe: bridge.subscribe,
		postMessage(message) {
			if (message.type === "permission/respond") {
				if (message.optionId === "cancel") {
					bridge.postMessage({
						type: "prompt/cancel",
						requestId: message.requestId,
						sessionId: message.sessionId,
						runId: message.runId,
					});
				} else {
					bridge.postMessage({
						...message,
						optionId:
							message.optionId === "accept" ? "allow" : "reject",
					});
				}
			} else {
				bridge.postMessage(message);
			}
		},
	};
}
