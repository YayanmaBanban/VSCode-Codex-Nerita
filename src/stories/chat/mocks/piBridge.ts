// Pi の表示用データを共通の通信境界へ渡す。
import { piState } from "../fixtures/pi";
import { createStoryBridge } from "./storyBridge";
import type { ChatState } from "../../../shared/chatState";
/** 実行中・完了・停止を独立した表示状態として指定する。 */
export function createPiBridge(
	showTools = false,
	run: ChatState["run"] = "idle",
) {
	return createStoryBridge(piState(run, showTools));
}
