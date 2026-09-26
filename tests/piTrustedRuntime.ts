// 既存の実 SDK テストでは、専用フィクスチャへの人の信頼操作を起動前に再現する。
import {
	createPiRuntime as createRuntime,
	type PiRuntimeOptions,
} from "../src/extension/backends/pi/PiRuntime";
import { WorkspaceTrustStore } from "../src/extension/security/trust/WorkspaceTrustStore";
export type {
	PiRuntimeSession,
	PiRuntimeOptions,
} from "../src/extension/backends/pi/PiRuntime";

/** 製品の既定値を緩めず、既存の承認・Sandbox 検証だけに明示的な信頼を設定する。 */
export async function createPiRuntime(options: PiRuntimeOptions) {
	const trustStore =
		options.trustStore ??
		new WorkspaceTrustStore({
			read: () => undefined,
			write: async () => {},
		});
	if (!options.trustStore) {
		for (const root of options.workspaceRoots ?? [options.cwd]) {
			await trustStore.setUserTrust(root, true);
		}
	}
	return createRuntime({
		...options,
		trustStore,
		workspaceTrusted: options.workspaceTrusted ?? true,
	});
}
