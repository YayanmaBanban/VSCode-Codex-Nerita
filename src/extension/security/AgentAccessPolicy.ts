// backendとモデルから独立したアクセス上限を保持する。
import { isAbsolute, relative, sep } from "node:path";

/** rootsはHostが実在するcanonical pathへ解決してから渡す。 */
export type AgentAccessPolicy = {
	filesystem: {
		/** allは保護対象を除くファイルreadを許可する。省略時はreadableRootsだけに制限する。 */
		readAccess?: "all" | "roots";
		/** readAccessがrootsまたは省略の場合の読取り上限。空配列は読取り禁止。 */
		readableRoots: readonly string[];
		/** Runtimeのcwdと自動指示ファイル探索の上限。旧policyではreadableRootsを使用する。 */
		workspaceRoots?: readonly string[];
		writableRoots: readonly string[];
		/** ファイルToolのread/writeとShellのwriteを拒否する。承認で解除しない。 */
		protectedPaths: readonly string[];
	};
	network: { enabled: boolean };
	command: {
		mode: "sandboxed" | "host" | "deny";
		/** allはCodex標準の全域read。省略・workspaceは有限readを要求し、未対応Executorでは拒否する。 */
		readAccess?: "all" | "workspace";
	};
};

/** Approvalと実行境界の共通判定。 */
export type AccessDecision =
	{ type: "allow" } | { type: "ask" | "deny"; reason: string };

/** パス要素単位で比較し、隣接する同名prefixを許可しない。 */
export function containsPath(root: string, target: string): boolean {
	const part = relative(root, target);
	return (
		part === "" ||
		(!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
	);
}

/** 外部readの許可からcwd・自動探索の権限を拡大しない。 */
export function policyWorkspaceRoots(
	policy: AgentAccessPolicy,
): readonly string[] {
	return policy.filesystem.workspaceRoots ?? policy.filesystem.readableRoots;
}

/** 親とroleの交差だけを残し、子から権限を拡大できなくする。 */
export function intersectAccessPolicies(
	parent: AgentAccessPolicy,
	role: AgentAccessPolicy,
): AgentAccessPolicy {
	let mode: AgentAccessPolicy["command"]["mode"] = "host";
	if (
		parent.command.mode === "sandboxed" ||
		role.command.mode === "sandboxed"
	) {
		mode = "sandboxed";
	}
	if (parent.command.mode === "deny" || role.command.mode === "deny") {
		mode = "deny";
	}
	return {
		filesystem: {
			...intersectReadAccess(parent.filesystem, role.filesystem),
			workspaceRoots: intersectRoots(
				policyWorkspaceRoots(parent),
				policyWorkspaceRoots(role),
			),
			writableRoots: intersectRoots(
				parent.filesystem.writableRoots,
				role.filesystem.writableRoots,
			),
			protectedPaths: [
				...new Set([
					...parent.filesystem.protectedPaths,
					...role.filesystem.protectedPaths,
				]),
			],
		},
		network: { enabled: parent.network.enabled && role.network.enabled },
		command: {
			mode,
			readAccess:
				parent.command.readAccess === "all" &&
				role.command.readAccess === "all"
					? "all"
					: "workspace",
		},
	};
}

/** 全域readは相手の上限をそのまま採用し、有限read同士は交差する。 */
function intersectReadAccess(
	parent: AgentAccessPolicy["filesystem"],
	role: AgentAccessPolicy["filesystem"],
): Pick<AgentAccessPolicy["filesystem"], "readAccess" | "readableRoots"> {
	if (parent.readAccess === "all") {
		return {
			readAccess: role.readAccess ?? "roots",
			readableRoots: [...role.readableRoots],
		};
	}
	if (role.readAccess === "all") {
		return {
			readAccess: "roots",
			readableRoots: [...parent.readableRoots],
		};
	}
	return {
		readAccess: "roots",
		readableRoots: intersectRoots(parent.readableRoots, role.readableRoots),
	};
}

/** 両方に含まれる実体ディレクトリだけを残す。 */
function intersectRoots(a: readonly string[], b: readonly string[]): string[] {
	return [
		...new Set(
			a.flatMap((root) =>
				b.flatMap((other) => {
					if (containsPath(root, other)) {
						return [other];
					}
					return containsPath(other, root) ? [root] : [];
				}),
			),
		),
	];
}

/** 現行Codex Sandboxで強制できないShell制約を、登録時と実行直前に拒否する。 */
export function shellAccessDeniedReason(
	policy: AgentAccessPolicy,
): string | undefined {
	if (policy.command.mode !== "sandboxed") {
		return "このpolicyではSandboxでのShell実行が許可されていません。";
	}
	if (policy.command.readAccess !== "all") {
		return "このSandboxでは有限の読取り範囲を強制できません。Codex側の対応が必要です。";
	}
	if (
		policy.filesystem.writableRoots.some((root) =>
			policy.filesystem.protectedPaths.some(
				(protectedPath) =>
					containsPath(root, protectedPath) ||
					containsPath(protectedPath, root),
			),
		)
	) {
		return "保護対象を含むSandbox書込みrootは許可できません。";
	}
	return undefined;
}
