// SDKの副作用ツールを包み、承認と取消を確認してから実処理へ渡す。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../security/ApprovedToolCall";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { isRecord } from "../../../shared/validation";

/** 実行ごとの入力をHostで確認し、許可された場合だけ戻る。 */
export type PiAuthorize = ToolAuthorizer;

/** 承認後にも取消を確認し、許可とStopが競合した場合の実行を防ぐ。 */
export function approvePiTool(
	tool: Omit<ToolDefinition, "renderCall" | "renderResult">,
	cwd: string,
	authorize: PiAuthorize,
	policy: AgentAccessPolicy,
): ToolDefinition {
	return {
		...tool,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			if (!isRecord(params)) {
				throw new Error("Tool引数が不正です。");
			}
			signal?.throwIfAborted();
			const approved = await approveToolCall(
				{ tool: `extension:${tool.name}`, params, cwd, policy },
				authorize,
				signal,
			);
			const call = consumeApprovedToolCall(approved);
			return tool.execute(
				id,
				call.params,
				approved.signal,
				update,
				context,
			);
		},
	};
}
