// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { textToolContent } from "@nerita/shared/toolContent";
import { createStoryBridge } from "./mocks/storyBridge";

/** 添付付きの利用者メッセージと、スクロールが必要な長い応答を用意する。 */
function initialScrollState(): ChatState {
	return {
		...initialState(),
		connection: "ready",
		sessionId: "scroll",
		messages: [
			{
				id: "user",
				role: "user",
				text: "添付ファイルを確認してください。",
				attachments: [
					{
						id: "file",
						name: "育成素材と必要数量の一覧をまとめた長いファイル名.txt",
						uri: "file:///workspace/materials.txt",
					},
				],
			},
			{
				id: "answer",
				role: "assistant",
				text: "段落の本文です。\n\n".repeat(40),
			},
		],
	};
}

export function createScrollControl() {
	let state = initialScrollState();
	const bridge = createStoryBridge(state);
	const emit = () => bridge.emit({ type: "state/snapshot", state });
	return {
		bridge,
		stream: () =>
			streamMarkdown(
				() => state,
				(next) => {
					state = next;
					emit();
				},
			),
		append() {
			state = {
				...state,
				revision: state.revision + 1,
				messages: state.messages.map((message) =>
					message.role === "assistant"
						? {
								...message,
								text:
									message.text +
									"追記した本文です。\n\n".repeat(8),
							}
						: message,
				),
			};
			emit();
		},
		tool() {
			state = {
				...state,
				revision: state.revision + 1,
				tools: [
					{
						id: "reason",
						kind: "think",
						title: "推論",
						status: "in_progress",
						paths: [],
						content: [
							textToolContent(
								"**高さが変わるツール本文**\n\n".repeat(20),
							),
						],
					},
				],
			};
			emit();
		},
		reset() {
			state = {
				...state,
				revision: state.revision + 1,
				sessionId: `${state.revision}`,
				tools: [],
			};
			emit();
		},
	};
}
/** Markdown の構文が途中で完成する累積本文を、描画フレームごとに Host から配信する。 */
async function streamMarkdown(
	getState: () => ChatState,
	update: (state: ChatState) => void,
) {
	const chunks = [
		"\n\n## 配信中の",
		"見出し\n\n**強調",
		"した本文**を追記します。\n\n",
		"| 項目 | 値 |\n",
		"| --- | --- |\n",
		"| 高さ | 更新中 |\n\n",
		"```ts\n",
		"const following = true;\n",
		"```\n\n",
		"- 一つ目の項目\n",
		"- 二つ目の項目\n\n",
		"配信が完了しました。\n\n",
	];
	for (const chunk of chunks) {
		const state = getState();
		update({
			...state,
			revision: state.revision + 1,
			run: "running",
			messages: state.messages.map((message) =>
				message.role === "assistant"
					? { ...message, text: message.text + chunk }
					: message,
			),
		});
		await new Promise(requestAnimationFrame);
	}
	const state = getState();
	update({ ...state, revision: state.revision + 1, run: "completed" });
}

export function createEmptyScrollControl() {
	let state: ChatState = {
		...initialState(),
		connection: "ready",
		sessionId: "empty-scroll",
	};
	const bridge = createStoryBridge(state);
	const emit = () => bridge.emit({ type: "state/snapshot", state });
	return {
		bridge,
		accept() {
			const request = bridge.sent.find(
				(message) => message.type === "prompt/send",
			);
			if (request?.type !== "prompt/send") {
				return;
			}
			state = {
				...state,
				revision: state.revision + 1,
				run: "running",
				messages: [
					{
						id: "empty-user",
						order: -1,
						role: "user",
						text: request.text,
					},
				],
			};
			emit();
			bridge.emit({
				type: "prompt/accepted",
				requestId: request.requestId,
				mode: "start",
			});
		},
		tool() {
			const index = state.tools.length;
			state = {
				...state,
				revision: state.revision + 1,
				tools: [
					...state.tools,
					{
						id: `empty-tool-${index}`,
						order: index,
						kind: "execute",
						title: `確認結果 ${index + 1}`,
						status: "completed",
						paths: [],
					},
				],
			};
			emit();
		},
		answer() {
			state = {
				...state,
				revision: state.revision + 1,
				messages: [
					...state.messages,
					{
						id: "empty-answer",
						order: state.tools.length,
						role: "assistant",
						text: "確認が完了しました。",
					},
				],
			};
			emit();
		},
	};
}
