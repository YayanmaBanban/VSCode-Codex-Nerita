// SDK の副作用ツールを包み、承認と取消を確認してから実処理へ渡す。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../security/ApprovedToolCall";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { z } from "zod";

/** 実行ごとの入力を Host で確認し、許可された場合だけ戻る。 */
export type PiAuthorize = ToolAuthorizer;

/** 承認後にも取消を確認し、許可と `Stop` が競合した場合の実行を防ぐ。 */
export function approvePiTool(
	tool: Omit<ToolDefinition, "renderCall" | "renderResult">,
	cwd: string,
	authorize: PiAuthorize,
	policy: AgentAccessPolicy = {
		workspaceRoots: [cwd],
		writableRoots: [cwd],
		shell: true,
		networkAccess: false,
		windowsSandbox: "elevated",
	},
	lifetime?: AbortSignal,
): ToolDefinition {
	return {
		...tool,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			const combined =
				lifetime && signal
					? AbortSignal.any([lifetime, signal])
					: (lifetime ?? signal);
			const approved = await approveToolCall(
				{
					tool: `extension:${tool.name}`,
					params: z.record(z.string(), z.unknown()).parse(params),
					cwd,
					policy,
				},
				authorize,
				combined,
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
