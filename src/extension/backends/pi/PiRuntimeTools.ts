// 実効policyで使えるToolだけをSDKへ登録し、停止中のShellをモデルへ公開しない。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import type { ToolAuthorizer } from "../../security/ApprovalGuard";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { shellAccessDeniedReason } from "../../security/AgentAccessPolicy";
import { createPiFileTools } from "./PiFileTools";
import { createPiSandboxPowerShellTool } from "./PiPowerShellTool";

/** 登録一覧と有効Tool一覧を同じ定義から作り、SDKの直接実行へ戻る余地を作らない。 */
export function createPiRuntimeTools(
	sdk: typeof PiSdk,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
	executor?: SandboxCommandExecutor,
): PiSdk.ToolDefinition[] {
	const tools = createPiFileTools(sdk, paths, authorize, lifetime);
	if (!shellAccessDeniedReason(paths.policy) && executor) {
		tools.push(
			createPiSandboxPowerShellTool(
				sdk.createPowerShellToolDefinition(paths.cwd),
				paths,
				authorize,
				executor,
				lifetime,
			),
		);
	}
	return tools;
}
