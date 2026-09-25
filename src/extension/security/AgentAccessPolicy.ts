// シェルの権限上限と、Host ファイルツールの書込み範囲を保持する。
import { isAbsolute, relative, sep } from "node:path";
import type { SandboxPolicy } from "../backends/codex/codex-app-server/v2/SandboxPolicy";

/** Windows 実装は親から継承し、`role` から変更できない。 */
export type WindowsSandboxImplementation = "elevated" | "unelevated";
/** `read` は OS のアクセス権に従い、有限 `read`・独自拒否対象パスは表現しない。 */
export type AgentAccessPolicy = {
	workspaceRoots: string[];
	writableRoots: string[];
	networkAccess: boolean;
	shell: boolean;
	windowsSandbox: WindowsSandboxImplementation;
};
/** 子の `role` は権限を縮小する項目だけを受け付ける。 */
export type AgentRole = Partial<
	Pick<AgentAccessPolicy, "writableRoots" | "networkAccess" | "shell">
>;

/** 兄弟パスの同名 `prefix` を含めず、OS のパス比較規則で配下を判定する。 */
export function containsPath(root: string, target: string): boolean {
	const path = relative(root, target);
	return (
		path === "" ||
		(!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
	);
}

/** 親と `role` の共通部分だけを返し、どの階層でも権限を拡大させない。 */
export function intersectPolicy(
	parent: AgentAccessPolicy,
	role: AgentRole,
): AgentAccessPolicy {
	const roots =
		role.writableRoots === undefined
			? parent.writableRoots
			: role.writableRoots.flatMap((requested) =>
					parent.writableRoots.flatMap((root) =>
						intersectRoot(root, requested),
					),
				);
	return {
		...parent,
		workspaceRoots: [...parent.workspaceRoots],
		writableRoots: [...new Set(roots)],
		networkAccess: parent.networkAccess && role.networkAccess !== false,
		shell: parent.shell && role.shell !== false,
	};
}

/** 2つの `root` の共通部分は包含される側だけになる。 */
function intersectRoot(root: string, requested: string): string[] {
	if (containsPath(root, requested)) {
		return [requested];
	}
	return containsPath(requested, root) ? [root] : [];
}

/** `cwd` の暗黙追加を防ぐ検査は `Executor` で行い、一時例外は常に無効にする。 */
export function toSandboxPolicy(policy: AgentAccessPolicy): SandboxPolicy {
	return policy.writableRoots.length
		? {
				type: "workspaceWrite",
				writableRoots: [...policy.writableRoots],
				networkAccess: policy.networkAccess,
				excludeTmpdirEnvVar: true,
				excludeSlashTmp: true,
			}
		: { type: "readOnly", networkAccess: policy.networkAccess };
}
