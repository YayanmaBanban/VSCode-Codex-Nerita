// 非 Windows のシェルは Pi の実行処理を維持し、承認と取消だけを接続する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../security/ApprovedToolCall";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";

const inputSchema = z
	.object({
		command: z.string().refine((value) => value.trim().length > 0),
		timeout: z.number().positive().optional(),
	})
	.passthrough();

/** SDK と信頼済みシェル拡張の両方に、同じ承認・role・`Stop` を適用する。 */
export function createPiHostShellTool(
	definition: Omit<ToolDefinition, "renderCall" | "renderResult">,
	cwd: string,
	authorize: ToolAuthorizer,
	policy: AgentAccessPolicy,
	lifetime: AbortSignal,
): ToolDefinition {
	// SDK の端末描画は引数型ごとに異なるため、Host には引き継がない。
	const terminalDefinition: ToolDefinition = definition;
	const {
		renderCall: _call,
		renderResult: _result,
		...tool
	} = terminalDefinition;
	return {
		...tool,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			const combined = signal
				? AbortSignal.any([signal, lifetime])
				: lifetime;
			const approved = await approveToolCall(
				{
					tool: tool.name,
					params: inputSchema.parse(params),
					cwd,
					policy,
					hostShell: true,
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
