// 同名の子を別タスクとして識別できる表示データと、その会話取得を再現する。
import { piAgentState } from "./fixtures/piAgents";
import { createChatStoryBridge } from "./mocks/mockBridge";

/** 初期状態と子の会話を、親から独立した Host 応答として渡す。 */
export function createPiAgentScenario(background: boolean) {
	const mock = createChatStoryBridge("streaming", "pi");
	const { agents, permissions } = piAgentState();
	mock.patchState({ agents, permissions, ...(background ? { run: "completed" as const } : {}) });
	const post = mock.postMessage.bind(mock);
	/** 子の取得要求は、選択した threadId に対応する内容を返す。 */
	function postMessage(message: Parameters<typeof post>[0]) {
		post(message);
		if (message.type !== "agent/read") { return; }
		mock.emit({ type: "agent/view", requestId: message.requestId, view: {
			threadId: message.threadId, parentThreadId: "story-session",
			messages: [
				{ id: "task", role: "user", text: "指定された対象を検査してください。", order: 0 },
				{ id: "answer", role: "assistant", text: "検査を進めています。", order: 1 },
			], tools: [], agents: [],
		} });
	}
	mock.postMessage = postMessage;
	return mock;
}
