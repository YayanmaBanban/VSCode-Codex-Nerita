// 承認待ちの表示データを操作から独立して生成する。

import { type ChatState } from "@nerita/shared/chatState";

import { toolApprovalPresentation } from "../../../../../apps/vscode-nerita/src/extension/security/toolApprovalPresentation";

/** ツール別の表示を選ぶ。承認の結果は計算しない。 */
export function piApprovalState(name: string): Partial<ChatState> {
	const shell = ["powershell", "pwsh", "bash"].includes(name);
	const runId = "pi-approval-run";
	const input = shell
		? {
				command:
					name === "bash"
						? "node --version"
						: "Get-Content -LiteralPath 'src/長いフォルダー名/README.md'",
				timeout: 30,
			}
		: {
				path: "src/長いフォルダー名/README.md",
				content: "変更する本文\n次の行",
			};
	return {
		run: "running",
		runId,
		messages: [
			{
				id: runId,
				role: "user",
				text: name,
				order: 1,
			},
		],
		tools: [
			{
				id: runId,
				runId,
				title: shell
					? name
					: "ファイルを書き込む: src/長いフォルダー名/README.md",
				kind: shell ? "execute" : "edit",
				status: "in_progress",
				paths: shell ? [] : [input.path!],
				rawInput: input,
				cwd: "workspace with spaces/project",
				order: 2,
			},
		],
		permissions: [
			{
				id: "pi-approval",
				...approvalStoryPresentation(name, input, shell),
				options: [
					{
						id: "accept",
						name: "今回のみ許可",
						kind: "allow",
					},
					{
						id: "decline",
						name: "拒否",
						kind: "deny",
					},
					{
						id: "cancel",
						name: "ターンを中止",
						kind: "abort",
					},
				],
			},
		],
	};
}

/** ツールと実行基盤に応じた承認表示を固定データから作る。 */
function approvalStoryPresentation(
	name: string,
	input:
		| { command: string; timeout: number; path?: never; content?: never }
		| { path: string; content: string; command?: never; timeout?: never },
	shell: boolean,
): ReturnType<typeof toolApprovalPresentation> {
	return toolApprovalPresentation({
		tool: name,
		params: input,
		cwd: "workspace with spaces/project",
		policy: {
			workspaceRoots: ["workspace with spaces/project"],
			writableRoots: ["workspace with spaces/project"],
			shell: true,
			networkAccess: false,
		},
		...(shell
			? {
					hostShell: name === "bash",
					command: [
						`${name}.exe`,
						"-NoLogo",
						"-NoProfile",
						"-NonInteractive",
						"-ExecutionPolicy",
						"Bypass",
						"-Command",
						input.command!,
					],
					timeoutMs: 30000,
					sandbox: {
						name: "Codex",
						details: [
							"Windows Sandbox: elevated",
							"workspace外もOS権限に従う / temp書込み例外: 無効",
						],
					},
				}
			: {}),
	});
}
