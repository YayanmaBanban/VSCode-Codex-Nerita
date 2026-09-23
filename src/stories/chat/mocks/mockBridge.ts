// Story ごとに独立する、App Server や認証を必要としない双方向 Bridge。
import { initialState, type ChatState } from "../../../shared/chatState";
import type { BackendId } from "../../../shared/backend";
import { type HostMessage, type UiMessage } from "../../../shared/messages";
import type { Bridge } from "../../../webview/vscodeBridge";
import { settingsFixture } from "../../../../tests/fixtures/settingsFixture";
import { mockSettings } from "./mockSettings";
import { mockWorkspacePaths, mockResolvePath } from "./mockWorkspacePaths";
import { mockWorkspaceSymbols } from "./mockWorkspaceSymbols";
import { mockSessionReferences } from "./mockSessionReferences";
import { mockMcpCommand } from "./mockMcpCommand";
import { createBuiltinUiRegistry } from "../../../extension/ui-contributions/builtinContributions";

/** Story の開始状態。 */
export type Scenario =
	| "empty"
	| "connecting"
	| "auth"
	| "streaming"
	| "completed"
	| "permission"
	| "cancelled"
	| "cancelling"
	| "failed"
	| "error";
/** 固定状態と操作シナリオのための初期スナップショットを生成する。 */
function scenarioState(scenario: Scenario): ChatState {
	const state: ChatState = {
		...initialState(),
		connection: "ready",
		cwd: "D:/workspace/project",
		sessionId: "story-session",
		configOptions: settingsFixture(),
	};
	if (scenario === "connecting") {
		state.connection = "connecting";
	}
	if (scenario === "auth") {
		state.connection = "auth-required";
		state.authMethods = [
			{ id: "chat-gpt", name: "ChatGPT" },
			{ id: "api-key", name: "API Key" },
		];
	}
	if (scenario === "error") {
		state.connection = "error";
		state.error =
			"Codexとの接続が切れました。再接続してやり直してください。";
	}
	if (
		[
			"streaming",
			"completed",
			"permission",
			"cancelled",
			"cancelling",
			"failed",
		].includes(scenario)
	) {
		state.runId = "story-run";
		state.messages = [
			{
				id: "user",
				role: "user",
				text: "設定ファイルの変更点を教えてください。",
			},
			{
				id: "assistant",
				role: "assistant",
				text: "設定を確認しています。\n\n変更はワークスペース内のファイルに限定し、型検査を実行します。",
			},
		];
		state.run = "running";
	}
	if (scenario === "completed") {
		state.run = "completed";
		state.messages[1]!.text = `設定ファイルの変更点を整理しました。\n\n\`\`\`ts\nconst config = { strict: true, target: 'ES2022' };\n\`\`\`\n\n型の検査を有効にして、実行前に問題を発見できる構成です。\n${"長いパスやコードも画面の幅に合わせて折り返します。".repeat(12)}`;
	}
	if (scenario === "permission") {
		state.tools = [
			{
				id: "edit",
				title: "設定ファイルを更新",
				status: "pending",
				paths: ["src/config/settings.ts"],
			},
		];
		state.permissions = [
			{
				id: "permission",
				title: "設定ファイルの変更を許可しますか？",
				options: [
					{ id: "allow", name: "今回のみ許可", kind: "allow_once" },
					{ id: "reject", name: "拒否", kind: "reject_once" },
				],
			},
		];
	}
	if (
		scenario === "cancelled" ||
		scenario === "cancelling" ||
		scenario === "failed"
	) {
		state.run = scenario;
	}
	return state;
}
/** 送信記録・購読・段階的な返信を持つ代替実装を作る。 */
export function createMockBridge(
	scenario: Scenario = "empty",
	backend: BackendId = "codex",
): Bridge & {
	sent: UiMessage[];
	emit: (event: HostMessage) => void;
	patchState: (changes: Partial<ChatState>) => void;
} {
	let state = scenarioState(scenario);
	const registry = createBuiltinUiRegistry();
	/** 全Storyで選択したbackendのHostと同じ宣言を生成する。 */
	const ui = () =>
		registry.resolve(state, {
			backend,
			provider: backend === "codex" ? "openai-codex" : "local",
			capabilities: state.configOptions.map((option) => option.id),
		});
	state.uiContributions = ui();
	const listeners = new Set<(event: HostMessage) => void>();
	const sent: UiMessage[] = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const emit = (event: HostMessage) => {
		listeners.forEach((listener) => listener(event));
	};
	const patch = (changes: Partial<ChatState>) => {
		state = { ...state, ...changes, revision: state.revision + 1 };
		state.uiContributions = ui();
		changes = { ...changes, uiContributions: state.uiContributions };
		emit({ type: "state/patch", revision: state.revision, patch: changes });
	};
	const clear = () => {
		timers.forEach(clearTimeout);
		timers.clear();
	};
	/** 認証解除後は会話を残さず、再ログイン可能な状態を再現する。 */
	const logout = () => {
		const { revision: _revision, ...reset } = scenarioState("auth");
		patch({
			...reset,
			sessionId: null,
			messages: [],
			tools: [],
			attachments: [],
		});
	};
	/** 固定シナリオと追加送信に共通の次の表示順を採番する。 */
	const nextOrder = () =>
		Math.max(
			0,
			...[...state.messages, ...state.tools].map(
				(item, index) => item.order ?? index,
			),
		) + 1;
	/** コマンドと段階的な返信をモック上で処理する。 */
	const sendPrompt = (
		message: Extract<UiMessage, { type: "prompt/send" }>,
	) => {
		if (message.text.trim() === "/logout") {
			clear();
			logout();
			emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		if (message.text.trim() === "/mcp") {
			timers.add(
				mockMcpCommand(
					state,
					message.requestId,
					nextOrder(),
					patch,
					emit,
				),
			);
			return;
		}
		if (message.text.trim() === "/new") {
			clear();
			const { revision: _revision, ...reset } = scenarioState("empty");
			patch(reset);
			emit({
				type: "prompt/accepted",
				requestId: message.requestId,
				mode: "start",
			});
			return;
		}
		const mode = state.run === "running" ? "steer" : "start";
		patch({
			attachments: [],
			run: "running",
			runId: "interactive-run",
			messages: [
				...state.messages,
				{
					id: crypto.randomUUID(),
					order: nextOrder(),
					role: "user",
					text: message.text,
					references: message.references ?? [],
				},
			],
		});
		emit({
			type: "prompt/accepted",
			requestId: message.requestId,
			mode,
		});
		const assistantId = crypto.randomUUID();
		timers.add(
			setTimeout(
				() =>
					patch({
						messages: [
							...state.messages,
							{
								id: assistantId,
								order: nextOrder(),
								role: "assistant",
								text: "依頼を確認しました。",
							},
						],
					}),
				150,
			),
		);
		timers.add(
			setTimeout(
				() =>
					patch({
						run: "completed",
						messages: state.messages.map((m) =>
							m.id === assistantId
								? {
										...m,
										text: `${m.text}\n作業が完了しました。`,
									}
								: m,
						),
					}),
				650,
			),
		);
		return;
	};
	/** 参照候補と初期状態の取得へモック応答を返す。 */
	const respondResource = (message: UiMessage): boolean => {
		switch (message.type) {
			case "workspace/resolvePath":
				// Hostの応答は貼り付けの編集確定より後のタスクで届く。
				setTimeout(() => emit(mockResolvePath(message)), 0);
				return true;
			case "session/searchReferences":
				queueMicrotask(() => emit(mockSessionReferences(message)));
				return true;
			case "workspace/searchSymbols":
				queueMicrotask(() => emit(mockWorkspaceSymbols(message)));
				return true;
			case "workspace/listPaths":
				queueMicrotask(() => emit(mockWorkspacePaths(message)));
				return true;
			case "ui/ready":
				emit({
					type: "state/snapshot",
					state: structuredClone(state),
				});
				return true;
		}
		return false;
	};
	return {
		sent,
		emit,
		patchState: patch,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				if (!listeners.size) {
					clear();
				}
			};
		},
		postMessage(message) {
			sent.push(message);
			const settings = mockSettings(state, message);
			if (settings) {
				patch(settings);
				return;
			}
			if (respondResource(message)) {
				return;
			}
			switch (message.type) {
				case "connection/retry":
				case "session/new":
				case "auth/start":
					clear();
					{
						const { revision: _revision, ...reset } =
							scenarioState("empty");
						patch(reset);
					}
					break;
				case "auth/logout":
					clear();
					logout();
					break;
				case "prompt/send":
					sendPrompt(message);
					break;
				case "prompt/cancel":
					clear();
					patch({
						run: "cancelled",
						permissions: [],
					});
					break;
				case "permission/respond":
					patch({
						permissions: [],
						run: "completed",
						tools: state.tools.map((tool) => ({
							...tool,
							status:
								message.optionId === "allow"
									? "completed"
									: "failed",
						})),
					});
					break;
			}
		},
	};
}
