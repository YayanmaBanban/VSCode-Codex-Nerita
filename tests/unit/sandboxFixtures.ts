// サンドボックス検証用の内側・外側フィクスチャを作り、削除先を生成した一時ディレクトリへ限定する。
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { WorkspaceTrustStore } from "../../src/extension/security/trust/WorkspaceTrustStore";
import { bindTrustContext } from "../../src/extension/security/trust/TrustGate";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../src/extension/security/WorkspacePathPolicy";

/** 外側フィクスチャも専用一時配下に置き、ユーザーデータに触れない。 */
export async function sandboxFixture() {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-sandbox-unit-")),
	);
	const cwd = join(root, "workspace");
	const outside = join(root, "outside");
	await Promise.all([mkdir(cwd), mkdir(outside)]);
	const basePolicy = await createWorkspaceAccessPolicy([cwd]);
	const trustStore = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	await trustStore.setUserTrust(cwd, true);
	const trust = bindTrustContext(trustStore, [cwd], () => true);
	const policy = { ...basePolicy, trustContextId: trust.id };
	const paths = new WorkspacePathPolicy(policy, cwd);
	return {
		root,
		cwd,
		outside,
		policy,
		paths,
		trustStore,
		trustContextId: trust.id,
		workspaceTrusted: true,
		async cleanup() {
			trust.dispose();
			if (
				dirname(root) !== (await realpath(tmpdir())) ||
				!basename(root).startsWith("nerita-sandbox-unit-")
			) {
				throw new Error("不正なfixture削除先");
			}
			await rm(root, { recursive: true, force: true });
		},
	};
}
