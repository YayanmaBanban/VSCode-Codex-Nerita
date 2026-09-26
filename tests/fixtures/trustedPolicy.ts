// Sandbox まで到達させる検証用に、指定した fixture だけへ一時的な信頼を設定する。
import { createWorkspaceAccessPolicy } from "../../src/extension/security/WorkspacePathPolicy";
import type { WindowsSandboxImplementation } from "../../src/extension/security/AgentAccessPolicy";
import { WorkspaceTrustStore } from "../../src/extension/security/trust/WorkspaceTrustStore";
import { bindTrustContext } from "../../src/extension/security/trust/TrustGate";

/** 信頼の前提だけを用意し、書込み範囲・承認・Sandbox の判定は本番処理へ渡す。 */
export async function trustedPolicy(
	roots: string[],
	mode: WindowsSandboxImplementation,
	trustedRoots = roots,
) {
	const store = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	for (const root of trustedRoots) {
		await store.setUserTrust(root, true);
	}
	const policy = await createWorkspaceAccessPolicy(roots, mode);
	const context = bindTrustContext(store, roots, () => true);
	return {
		policy: { ...policy, trustContextId: context.id },
		dispose: context.dispose,
	};
}
