// 承認要求は初期状態として注入し、選択した操作は記録する。
import { piState } from "../fixtures/pi";
import { piApprovalState } from "../fixtures/piApproval";
import { createStoryBridge } from "./storyBridge";
/** ファイルと各シェルの承認カードを独立して表示する。 */
export function createPiApprovalBridge(tool = "write") {
	return createStoryBridge({ ...piState(), ...piApprovalState(tool) });
}
