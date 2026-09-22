// Piの承認前後だけを再現し、副作用と実SDKの確認はHostテストで行う。
import { initialState, type ChatState } from "../../../shared/chatState";
import type { HostMessage } from "../../../shared/messages";
import type { Bridge } from "../../../webview/vscodeBridge";

/** 承認・拒否・停止を実際のチャットUIから操作する。 */
export function createPiApprovalBridge(): Bridge {
	let state: ChatState = {
		...initialState(),
		uiContributions: { surface: "pi", items: [] },
		connection: "ready",
		sessionId: "pi-approval",
		sessionTitle: "Pi",
		cwd: "D:/workspace with spaces/project",
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
				const shell = message.text === "powershell";
				const runId = crypto.randomUUID();
				const input = shell
					? {
							command:
								"Get-Content -LiteralPath 'src/長いフォルダー名/README.md'",
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
								? "powershell"
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
							title: `Pi: ${shell ? "powershell" : "write"} の実行承認\n作業フォルダー: ${state.cwd}\n${JSON.stringify(input, null, 2)}`,
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
			if (
				message.type === "permission/respond" ||
				message.type === "prompt/cancel"
			) {
				const choice =
					message.type === "prompt/cancel"
						? "cancel"
						: message.optionId;
				const text = approvalResultText(choice);
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

/** 承諾・拒否・停止の結果をモックの本文へ反映する。 */
function approvalResultText(choice: string) {
	if (choice === "accept") {
		return "操作が完了しました。";
	}
	if (choice === "decline") {
		return "ユーザーが実行を拒否しました。操作は実行されていません。";
	}
	return "処理を停止しました。";
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
