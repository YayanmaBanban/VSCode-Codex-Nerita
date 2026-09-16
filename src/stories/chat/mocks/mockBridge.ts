// Story ごとに独立する、App Server や認証を必要としない双方向 Bridge。
import {
	initialState,
	type ChatState,
	type HostMessage,
	type UiMessage,
} from "../../../shared/messages";
import type { Bridge } from "../../../webview/vscodeBridge";
import { settingsFixture } from "../../../../tests/fixtures/settingsFixture";
import { mockSettings } from "./mockSettings";

/** Story の開始状態。 */
export type Scenario =
	| "empty"
	| "connecting"
	| "auth"
	| "streaming"
	| "completed"
	| "permission"
	| "cancelled"
	| "error";
/** 固定状態と操作シナリオのための初期スナップショットを生成する。 */
function scenarioState(scenario: Scenario): ChatState {
	const state: ChatState = {
		...initialState(),
		connection: "ready",
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
		["streaming", "completed", "permission", "cancelled"].includes(scenario)
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
	if (scenario === "cancelled") {
		state.run = "cancelled";
	}
	return state;
}
/** 送信記録・購読・段階的な返信を持つ代替実装を作る。 */
export function createMockBridge(scenario: Scenario = "empty"): Bridge & {
	sent: UiMessage[];
	emit: (event: HostMessage) => void;
	patchState: (changes: Partial<ChatState>) => void;
} {
	let state = scenarioState(scenario);
	const listeners = new Set<(event: HostMessage) => void>();
	const sent: UiMessage[] = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const emit = (event: HostMessage) => {
		listeners.forEach((listener) => listener(event));
	};
	const patch = (changes: Partial<ChatState>) => {
		state = { ...state, ...changes, revision: state.revision + 1 };
		emit({ type: "state/patch", revision: state.revision, patch: changes });
	};
	const clear = () => {
		timers.forEach(clearTimeout);
		timers.clear();
	};
	/** 固定シナリオと追加送信に共通の次の表示順を採番する。 */
	const nextOrder = () =>
		Math.max(
			0,
			...[...state.messages, ...state.tools].map(
				(item, index) => item.order ?? index,
			),
		) + 1;
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
			switch (message.type) {
				case "ui/ready":
					emit({
						type: "state/snapshot",
						state: structuredClone(state),
					});
					break;
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
				case "prompt/send": {
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
							},
						],
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
					break;
				}
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
