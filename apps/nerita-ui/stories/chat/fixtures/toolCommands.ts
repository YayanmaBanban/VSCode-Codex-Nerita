// Host が正規化した見出しと、本文に残す実行コマンドを再現する。
import type { ToolSummary } from "@nerita/shared/chatState";

export const commandTools: ToolSummary[] = [
	{
		id: "codex-command",
		title: "Get-Content ./src/chat/tools/ToolCard.tsx; rg SettingsTooltip ./src/chat",
		kind: "execute",
		status: "in_progress",
		paths: [],
		cwd: "./workspace/project",
		rawInput: {
			command:
				'"./WindowsPowerShell/powershell.exe" -NoProfile -Command "Get-Content ./src/chat/tools/ToolCard.tsx; rg SettingsTooltip ./src/chat"',
		},
		output: { preview: "Codex の実行結果", truncated: false },
	},
	{
		id: "pi-command",
		title: 'Get-Location\nWrite-Output "日本語の出力を確認します"',
		kind: "execute",
		status: "in_progress",
		paths: [],
		rawInput: {
			command: 'Get-Location\nWrite-Output "日本語の出力を確認します"',
		},
		output: { preview: "Pi の実行結果", truncated: false },
	},
	{
		id: "closed-command",
		title: "pnpm.cmd check",
		kind: "execute",
		status: "in_progress",
		paths: [],
		output: { preview: "型チェックの結果", truncated: false },
	},
];
