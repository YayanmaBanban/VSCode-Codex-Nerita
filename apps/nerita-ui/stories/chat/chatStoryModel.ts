// 各ストーリーで独立した Host 応答を作り、チャット本体へ接続する。
import type { ChatState } from "@nerita/shared/chatState";
import { createChatStoryBridge, type Scenario } from "./mocks/mockBridge";
import { createAppServerBridge } from "./mocks/appServerBridge";
import { createCodexLifecycleBridge } from "./mocks/codexLifecycleBridge";
import { createPiBridge } from "./mocks/piBridge";
import { createPiApprovalBridge } from "./mocks/piApprovalBridge";
import { createPiHistoryBridge } from "./mocks/piHistoryBridge";

/** 接続先と描画状態の組み合わせ。 */
export type ChatStoryProps = {
	scenario: Scenario; appServer?: boolean; pi?: boolean; piTools?: boolean;
	piNestedTools?: boolean; piApprovals?: boolean; piHistory?: boolean;
	piRun?: ChatState["run"]; approvalTool?: string;
};

/** 既存の Codex / Pi / 履歴 / 承認の状態を同じ優先順位で選ぶ。 */
export function createChatScenario(props: ChatStoryProps) {
	const pi = createPiScenario(props);
	if (pi) { return pi; }
	if (props.appServer === true) { return createAppServerBridge(props.scenario); }
	if (props.scenario === "auth") { return createCodexLifecycleBridge("success"); }
	if (props.scenario === "error") { return createCodexLifecycleBridge("reconnect"); }
	return createChatStoryBridge(props.scenario);
}

/** Pi 固有の履歴・承認・ツール表示を先に選ぶ。 */
function createPiScenario(props: ChatStoryProps) {
	if (props.piHistory === true) { return createPiHistoryBridge(); }
	if (props.piApprovals === true) { return createPiApprovalBridge(props.approvalTool ?? "write"); }
	const pi = props.pi === true || props.piTools === true || props.piNestedTools === true;
	if (pi) { return createPiBridge(props.piTools ?? false, props.piRun ?? "idle", props.piNestedTools ?? false); }
	return null;
}
