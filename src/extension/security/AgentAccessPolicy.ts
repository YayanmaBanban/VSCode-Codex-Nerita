// シェルの権限上限と、Host ファイルツールの書込み範囲を保持する。
import { isAbsolute, relative, sep } from "node:path";
import type { SandboxPolicy } from "../backends/codex/codex-app-server/v2/SandboxPolicy";

/** Windows 実装は親から継承し、`role` から変更できない。 */
export type WindowsSandboxImplementation = "elevated" | "unelevated";
/** 読取りは OS のアクセス権に従う。この型では読取りの許可範囲や独自の拒否対象パスを定義しない。 */
export type AgentAccessPolicy = {
	workspaceRoots: string[];
	writableRoots: string[];
	networkAccess: boolean;
	shell: boolean;
	windowsSandbox: WindowsSandboxImplementation;
	guardrailsRoot?: string;
};
/** 子の `role` は権限を縮小する項目だけを受け付ける。 */
export type AgentRole = Partial<
	Pick<AgentAccessPolicy, "writableRoots" | "networkAccess" | "shell">
>;

/** 共通の接頭辞を持つ別ディレクトリを含めず、相対パスから指定ルートの配下か判定する。 */
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

/** 一方のルートが他方を含む場合は狭い方を返し、共通する範囲がなければ空配列を返す。 */
function intersectRoot(root: string, requested: string): string[] {
	if (containsPath(root, requested)) {
		return [requested];
	}
	return containsPath(requested, root) ? [root] : [];
}

/** 一時ディレクトリへの書込み例外を無効にする。cwd が書込み範囲を広げないかの検査は実行側で行う。 */
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
