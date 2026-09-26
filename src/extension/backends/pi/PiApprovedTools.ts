// SDK の副作用ツールを包み、承認と取消を確認してから実処理へ渡す。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../security/ApprovedToolCall";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { z } from "zod";
import { evaluateTrust } from "../../security/trust/TrustGate";

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
	checkOrigin?: () => Promise<void>,
): ToolDefinition {
	return {
		...tool,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			await checkOrigin?.();
			const input = z.record(z.string(), z.unknown()).parse(params);
			const combined =
				lifetime && signal
					? AbortSignal.any([lifetime, signal])
					: (lifetime ?? signal);
			const approved = await approveToolCall(
				{
					tool: `extension:${tool.name}`,
					params: input,
					externalRead:
						!!checkOrigin && isRawPublicFetch(tool.name, input),
					cwd,
					policy,
				},
				authorize,
				combined,
			);
			const call = consumeApprovedToolCall(approved);
			await evaluateTrust(call);
			await checkOrigin?.();
			approved.signal.throwIfAborted();
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

/** 認証や任意オプションを伴う取得は、未信頼用の読取りとして扱わない。 */
function isRawPublicFetch(
	name: string,
	params: Record<string, unknown>,
): boolean {
	if (
		name !== "fetch_content" ||
		params.mode !== "raw" ||
		typeof params.url !== "string"
	) {
		return false;
	}
	if (Object.keys(params).some((key) => !["url", "mode"].includes(key))) {
		return false;
	}
	try {
		const url = new URL(params.url);
		return url.protocol === "https:" && !url.username && !url.password;
	} catch {
		return false;
	}
}
