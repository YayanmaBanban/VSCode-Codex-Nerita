// シェルの権限上限と、Host ファイルツールの書込み範囲を保持する。
import { isAbsolute, relative, sep } from "node:path";
/** Pi は `readableRoots` を指定する。未指定の既存バックエンドは OS の読取り権限に従う。 */
export type AgentAccessPolicy = {
	workspaceRoots: string[];
	readableRoots?: string[];
	writableRoots: string[];
	networkAccess: boolean;
	/** Host のネットワーク設定だけが指定し、子 role は変更できない。 */
	hostLoopbackAccess?: boolean;
	shell: boolean;
	guardrailsRoot?: string;
	trustContextId?: string | undefined;
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
