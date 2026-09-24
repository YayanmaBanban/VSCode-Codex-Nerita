// backendとモデルから独立したアクセス上限を保持する。
import { isAbsolute, relative, sep } from "node:path";

/** rootsはHostが実在するcanonical pathへ解決してから渡す。 */
export type AgentAccessPolicy = {
	filesystem: {
		readableRoots: readonly string[];
		writableRoots: readonly string[];
		protectedPaths: readonly string[];
	};
	network: { enabled: boolean };
	command: { mode: "sandboxed" | "host" | "deny" };
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

/** 親とroleの交差だけを残し、子から権限を拡大できなくする。 */
export function intersectAccessPolicies(
	parent: AgentAccessPolicy,
	role: AgentAccessPolicy,
): AgentAccessPolicy {
	const intersect = (a: readonly string[], b: readonly string[]) => [
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
			readableRoots: intersect(
				parent.filesystem.readableRoots,
				role.filesystem.readableRoots,
			),
			writableRoots: intersect(
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
		command: { mode },
	};
}
