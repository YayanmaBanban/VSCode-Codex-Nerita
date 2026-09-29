// 送信記録と Host イベントの注入だけを提供する。操作の意味は解釈しない。
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import type { Bridge } from "@nerita/shared/bridge";

/** 表示検証から通信境界を操作するための窓口。 */
export type StoryBridge = Bridge & {
	sent: UiMessage[];
	emit(message: HostMessage): void;
	patchState(patch: Partial<ChatState>): void;
};

/** 初期状態を保持し、明示的に注入された差分だけを配信する。 */
export function createStoryBridge(initial: ChatState): StoryBridge {
	let state = structuredClone(initial);
	const sent: UiMessage[] = [];
	const listeners = new Set<(message: HostMessage) => void>();
	const emit = (message: HostMessage) => {
		if (message.type === "state/snapshot") {
			state = structuredClone(message.state);
		}
		if (message.type === "state/patch") {
			state = {
				...state,
				...structuredClone(message.patch),
				revision: message.revision,
			};
		}
		for (const listener of listeners) {
			listener(structuredClone(message));
		}
	};
	return {
		sent,
		emit,
		patchState(patch) {
			emit({ type: "state/patch", revision: state.revision + 1, patch });
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message) {
			sent.push(structuredClone(message));
			if (message.type === "ui/ready") {
				emit({ type: "state/snapshot", state });
			}
		},
	};
}
