// 承認前に要求全体を固定し、既存 `Permission` UI から1回限りの `permit` を発行する。
import {
	freezeToolCall,
	issueApprovedToolCall,
	type ToolCall,
} from "./ApprovedToolCall";
import type { PermissionPresentation } from "../../shared/permission";
import { toolApprovalPresentation } from "./toolApprovalPresentation";

/** UI の許可と `Stop` を同じ寿命に結び付ける。 */
export type ToolAuthorizer = (
	presentation: PermissionPresentation,
	signal?: AbortSignal,
) => Promise<AbortSignal>;

/** Phase 11では毎回承認を基準とし、詳細解析の追加先を分離する。 */
export function assessToolCall(call: ToolCall): "allow" | "ask" {
	if ((call.command || call.hostShell) && !call.policy.shell) {
		throw new Error("このroleではShell実行が禁止されています。");
	}
	return !call.command &&
		!call.hostShell &&
		["read", "ls"].includes(call.tool)
		? "allow"
		: "ask";
}

/** `env` の値は表示せず、実行と同一の操作・cwd・実効範囲を提示する。 */
export async function approveToolCall(
	input: ToolCall,
	authorize: ToolAuthorizer,
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const call = freezeToolCall(input);
	const decision = assessToolCall(call);
	const approvalSignal =
		decision === "ask"
			? await authorize(toolApprovalPresentation(call), signal)
			: (signal ?? new AbortController().signal);
	return issueApprovedToolCall(
		call,
		signal ? AbortSignal.any([signal, approvalSignal]) : approvalSignal,
	);
}
