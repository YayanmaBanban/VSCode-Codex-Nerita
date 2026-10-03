// バックエンドの通知を表示用カードへ変換し、見出しと実行コマンドの分離を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "@nerita/shared/chatState";
import { itemPatch } from "../../apps/vscode-nerita/src/extension/backends/codex/items/chatItems";
import { mapPiTool } from "../../apps/vscode-nerita/src/extension/backends/pi/PiToolMapper";

const shellCommand =
	'"./WindowsPowerShell/powershell.exe" -NoProfile -Command "Get-Content ./src/chat.tsx"';

for (const [name, command, commandActions, expected] of [
	[
		"解析済みの操作",
		shellCommand,
		[{ type: "unknown", command: "Get-Content ./src/chat.tsx" }],
		"Get-Content ./src/chat.tsx",
	],
	[
		"複数の操作",
		shellCommand,
		[
			{ type: "read", command: "Get-Content ./a.ts" },
			{ type: "search", command: "rg test ./src" },
		],
		"Get-Content ./a.ts; rg test ./src",
	],
	[
		"解析結果の起動引数",
		shellCommand,
		[{ type: "unknown", command: shellCommand }],
		"Get-Content ./src/chat.tsx",
	],
	["解析結果なし", shellCommand, [], "Get-Content ./src/chat.tsx"],
	[
		"大文字小文字と複数行",
		"pwsh -NoProfile -command 'Get-Location\nWrite-Output \"日本語\"'",
		undefined,
		'Get-Location\nWrite-Output "日本語"',
	],
	[
		"通常コマンド内の文字列",
		'Write-Output "powershell -Command test"',
		[],
		'Write-Output "powershell -Command test"',
	],
	[
		"空または不正な解析結果",
		"pnpm.cmd test",
		[{ command: "" }, { command: 42 }, null],
		"pnpm.cmd test",
	],
] as const) {
	void test(`Codex の${name}から見出しを作り、開始・完了時とも元のコマンドを保持する`, () => {
		const state = { ...initialState(), runId: "run" };
		const item = {
			id: "shell",
			type: "commandExecution",
			command,
			commandActions,
			cwd: "./workspace",
		};
		const started = itemPatch(state, item, false).tools!;
		assert.equal(started[0]!.title, expected);
		assert.deepEqual(started[0]!.rawInput, { command });
		const completed = itemPatch(
			{ ...state, tools: started },
			item,
			true,
		).tools!;
		assert.equal(completed.length, 1);
		assert.equal(completed[0]!.title, expected);
		assert.deepEqual(completed[0]!.rawInput, { command });
	});
}

void test("Pi の PowerShell 入力を見出しに使い、入力のない完了通知でも保持する", () => {
	const state = { ...initialState(), runId: "run" };
	const command = 'Get-Content ./src/chat.tsx\nWrite-Output "日本語"';
	const started = mapPiTool(
		{
			type: "tool_execution_start",
			toolCallId: "shell",
			toolName: "powershell",
			args: { command, timeout: 60 },
		},
		state,
	)!.tools!;
	assert.equal(started[0]!.title, command);
	const completed = mapPiTool(
		{
			type: "tool_execution_end",
			toolCallId: "shell",
			toolName: "powershell",
			isError: false,
			result: { content: [{ type: "text", text: "完了" }] },
		},
		{ ...state, tools: started },
	)!.tools!;
	assert.equal(completed[0]!.title, command);
	assert.deepEqual(completed[0]!.rawInput, { command, timeout: 60 });
});
