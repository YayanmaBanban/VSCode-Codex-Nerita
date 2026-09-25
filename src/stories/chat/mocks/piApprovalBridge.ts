// Pi の承認前後だけを再現し、副作用と実 SDK の確認は Host テストで行う。

import { initialState, type ChatState } from "../../../shared/chatState";
import type { HostMessage, UiMessage } from "../../../shared/messages";
import type { Bridge } from "../../../webview/vscodeBridge";

/** 承認・拒否・停止を実際のチャット UI から操作する。 */
export function createPiApprovalBridge(): Bridge {
	let state: ChatState = {
		...initialState(),
		uiContributions: { surface: "pi", items: [] },
		connection: "ready",
		sessionId: "pi-approval",
		sessionTitle: "Pi",
		cwd: "workspace with spaces/project",
		attachmentsSupported: false,
	};
	const listeners = new Set<(event: HostMessage) => void>();
	const emit = (event: HostMessage) => {
		for (const listener of listeners) {
			listener(event);
		}
	};
	const patch = (changes: Partial<ChatState>) => {
		state = { ...state, ...changes, revision: state.revision + 1 };
		emit({ type: "state/patch", revision: state.revision, patch: changes });
	};
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message) {
			if (message.type === "ui/ready") {
				emit({ type: "state/snapshot", state });
			}
			if (message.type === "prompt/send") {
				startApprovalPrompt(message, patch, state, emit);
			}
			if (
				message.type === "permission/respond" ||
				message.type === "prompt/cancel"
			) {
				const choice =
					message.type === "prompt/cancel"
						? "cancel"
						: message.optionId;
				const text = approvalResultText(
					choice,
					state.tools.at(-1)?.title,
				);
				patch({
					permissions: [],
					run: choice === "cancel" ? "cancelled" : "completed",
					tools: state.tools.map((tool) =>
						tool.runId !== state.runId
							? tool
							: {
									...tool,
									status: approvalToolStatus(choice),
									content: [
										{
											type: "content",
											content: { type: "text", text },
										},
									],
								},
					),
				});
			}
		},
	};
}

/** 承認待ちのツール実行をモック上で開始する。 */
function startApprovalPrompt(
	message: Extract<UiMessage, { type: "prompt/send" }>,
	patch: (changes: Partial<ChatState>) => void,
	state: ChatState,
	emit: (event: HostMessage) => void,
) {
	const shell = ["powershell", "pwsh", "bash"].includes(message.text);
	const runId = crypto.randomUUID();
	const input = shell
		? {
				command:
					message.text === "bash"
						? "node --version"
						: "Get-Content -LiteralPath 'src/長いフォルダー名/README.md'",
				timeout: 30,
			}
		: {
				path: "src/長いフォルダー名/README.md",
				content: "変更する本文\n次の行",
			};
	patch({
		run: "running",
		runId,
		messages: [
			...state.messages,
			{
				id: runId,
				role: "user",
				text: message.text,
				order: state.revision + 1,
			},
		],
		tools: [
			...state.tools,
			{
				id: runId,
				runId,
				title: shell
					? message.text
					: "ファイルを書き込む: src/長いフォルダー名/README.md",
				kind: shell ? "execute" : "edit",
				status: "in_progress",
				paths: shell ? [] : [input.path!],
				rawInput: input,
				cwd: state.cwd!,
				order: state.revision + 2,
			},
		],
		permissions: [
			{
				id: crypto.randomUUID(),
				title: [
					`Pi: ${shell ? message.text : "write"} の実行承認`,
					`作業フォルダー: ${state.cwd}`,
					JSON.stringify(input, null, 2),
					...approvalScope(message.text, state.cwd!, input.command),
				].join("\n"),
				options: [
					{
						id: "accept",
						name: "今回のみ許可",
						kind: "allow_once",
					},
					{
						id: "decline",
						name: "拒否",
						kind: "reject_once",
					},
					{
						id: "cancel",
						name: "ターンを中止",
						kind: "reject_once",
					},
				],
			},
		],
	});
	emit({
		type: "prompt/accepted",
		requestId: message.requestId,
		mode: "start",
	});
}

/** Host シェルにはサンドボックスや OS 隔離の制限があるような表示を付けない。 */
function approvalScope(name: string, cwd: string, command?: string) {
	if (name === "bash") {
		return ["実行範囲: Pi Shell（OSの権限で実行）"];
	}
	if (!command) {
		return [
			"実行範囲: HostファイルTool（Sandbox外）",
			`書込み許可: ${cwd}`,
		];
	}
	return [
		"実行範囲: Shell Sandbox",
		`書込み許可: ${cwd}`,
		`実行argv: ${JSON.stringify(shellArgv(name, command))}`,
		"制限時間: 30000 ms",
		"Shell network設定: 無効",
		"Sandbox実装: Codex",
		"Windows Sandbox: elevated",
		"Shell read: workspace外もOS権限に従う / temp書込み例外: 無効",
	];
}

/** 承諾・拒否・停止の結果をモックの本文へ反映する。 */
function approvalResultText(choice: string, tool?: string) {
	if (choice === "accept") {
		// `powershell` では文字コードの初期化も拒否された場合の警告表示を確認する。
		return tool === "powershell"
			? "WARNING: Nerita: [Console]::InputEncoding UTF-8 was not applied: PropertySetterNotSupportedInConstrainedLanguage\nWARNING: Nerita: [Console]::OutputEncoding UTF-8 was not applied: PropertySetterNotSupportedInConstrainedLanguage\n操作が完了しました。"
			: "操作が完了しました。";
	}
	if (choice === "decline") {
		return "ユーザーが実行を拒否しました。操作は実行されていません。";
	}
	return "処理を停止しました。";
}

/** ストーリー内の仮想配置。Host 実装に依存せず、承認に現れるシェルの差を再現する。 */
function shellArgv(name: string, command: string) {
	const setup =
		name === "powershell"
			? [
					"$OutputEncoding",
					"[Console]::InputEncoding",
					"[Console]::OutputEncoding",
				].map(
					(target) =>
						`try { ${target} = [System.Text.Encoding]::UTF8 } catch { if (${target}.CodePage -ne 65001) { Write-Warning ('Nerita: ${target} UTF-8 was not applied: ' + $_.FullyQualifiedErrorId) } }`,
				)
			: [];
	return [
		name === "powershell"
			? "Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
			: "PowerShell/7/pwsh.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-OutputFormat",
		"Text",
		"-Command",
		[
			"$ProgressPreference = 'SilentlyContinue'",
			...(name === "powershell"
				? [
						'& "$env:SystemRoot\\System32\\cmd.exe" /d /c \'"%SystemRoot%\\System32\\chcp.com" 65001 >nul\'',
					]
				: []),
			...setup,
			command,
		].join("\n"),
	];
}

/** 承認の選択結果をモックのツール状態へ変換する。 */
function approvalToolStatus(
	choice: string,
): "completed" | "failed" | "cancelled" {
	if (choice === "accept") {
		return "completed";
	}
	if (choice === "decline") {
		return "failed";
	}
	return "cancelled";
}
