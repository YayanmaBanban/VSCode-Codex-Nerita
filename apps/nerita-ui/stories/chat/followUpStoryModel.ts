// 受付待ち中の状態更新と、最初の失敗・再送を再現する。
import type { UiMessage } from "@nerita/shared/messages";
import type { StoryBridge } from "./mocks/storyBridge";
import { createChatStoryBridge } from "./mocks/mockBridge";

/** 最初の要求だけを失敗させ、解除時にはすべての予約を取り消す。 */
export function createFollowUpScenario(
	failFirst: boolean,
	completed: boolean,
): StoryBridge {
	const base = createChatStoryBridge(completed ? "completed" : "streaming");
	let count = 0;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	/** 要求の内容を変更せず、受付の遅延と失敗だけを再現する。 */
	function postMessage(message: UiMessage) {
		base.postMessage(message);
		if (message.type !== "prompt/send") {
			return;
		}
		const fail = failFirst && count++ === 0;
		timers.add(
			setTimeout(
				() => base.patchState({ usage: { used: 100, size: 1000 } }),
				100,
			),
		);
		timers.add(
			setTimeout(() => {
				if (fail) {
					base.emit({
						type: "request/failed",
						requestId: message.requestId,
						error: "フォローアップを送信できませんでした。",
					});
				} else {
					base.emit({
						type: "prompt/accepted",
						requestId: message.requestId,
						mode: completed ? "start" : "steer",
					});
				}
			}, 500),
		);
	}
	/** 最後の購読解除で予約の通知が破棄した画面へ到着しないようにする。 */
	function subscribe(listener: Parameters<StoryBridge["subscribe"]>[0]) {
		const unsubscribe = base.subscribe(listener);
		return () => {
			unsubscribe();
			for (const timer of timers) {
				clearTimeout(timer);
			}
			timers.clear();
		};
	}
	return { ...base, postMessage, subscribe };
}
