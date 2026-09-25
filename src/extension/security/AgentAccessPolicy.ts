// Shellの権限上限と、HostファイルToolの書込み範囲を保持する。
import { isAbsolute, relative, sep } from "node:path";
import type { SandboxPolicy } from "../backends/codex/codex-app-server/v2/SandboxPolicy";

/** Windows実装は親から継承し、roleから変更できない。 */
export type WindowsSandboxImplementation = "elevated" | "unelevated";
/** readはOSのアクセス権に従い、有限read・独自deny pathは表現しない。 */
export type AgentAccessPolicy = {
	workspaceRoots: string[];
	writableRoots: string[];
	networkAccess: boolean;
	shell: boolean;
	windowsSandbox: WindowsSandboxImplementation;
};
/** 子のroleは権限を縮小する項目だけを受け付ける。 */
export type AgentRole = Partial<
	Pick<AgentAccessPolicy, "writableRoots" | "networkAccess" | "shell">
>;

/** siblingの同名prefixを含めず、OSのパス比較規則で配下を判定する。 */
export function containsPath(root: string, target: string): boolean {
	const path = relative(root, target);
	return (
		path === "" ||
		(!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
	);
}

/** 親とroleの共通部分だけを返し、どの階層でも権限を拡大させない。 */
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

/** 二つのrootの共通部分は包含される側だけになる。 */
function intersectRoot(root: string, requested: string): string[] {
	if (containsPath(root, requested)) {
		return [requested];
	}
	return containsPath(requested, root) ? [root] : [];
}

/** cwdの暗黙追加を防ぐ検査はExecutorで行い、temp例外は常に無効にする。 */
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
