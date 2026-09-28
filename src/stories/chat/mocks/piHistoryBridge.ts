// Pi の保存済み表示を注入し、履歴の操作は送信記録だけを残す。
import { piHistoryState } from "../fixtures/piHistory";
import { createStoryBridge } from "./storyBridge";
/** 復元済み状態と履歴候補を固定する。 */
export function createPiHistoryBridge() {
	return createStoryBridge(piHistoryState());
}
