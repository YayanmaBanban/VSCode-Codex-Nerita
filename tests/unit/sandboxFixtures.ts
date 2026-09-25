// Sandbox検証用の内側・外側fixtureを作り、削除先を生成したtempディレクトリへ限定する。
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../src/extension/security/WorkspacePathPolicy";

/** 外側fixtureも専用temp配下に置き、ユーザーデータに触れない。 */
export async function sandboxFixture() {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-sandbox-unit-")),
	);
	const cwd = join(root, "workspace");
	const outside = join(root, "outside");
	await Promise.all([mkdir(cwd), mkdir(outside)]);
	const policy = await createWorkspaceAccessPolicy([cwd]);
	const paths = new WorkspacePathPolicy(policy, cwd);
	return {
		root,
		cwd,
		outside,
		policy,
		paths,
		async cleanup() {
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
