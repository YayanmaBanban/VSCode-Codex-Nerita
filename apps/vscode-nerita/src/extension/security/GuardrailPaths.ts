// パスの表記と実体を両方検査し、リンク経由の保護対象へのアクセスも判定する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { relative, resolve } from "node:path";
import type {
	GuardrailsConfig,
	GuardAction,
	PathRule,
} from "@nerita/shared/guardrails/config";
import type { GuardResult } from "@nerita/shared/guardrails/messages";
import { canonicalPath } from "./WorkspacePathPolicy";
import { containsPath } from "./AgentAccessPolicy";
import { matchPath } from "./GuardrailGlob";
import { isManagedDlcPath } from "@nerita/shared/dlc/managedPaths";
import { builtinPathDefinitions } from "@nerita/shared/guardrails/builtins";

export { matchPath } from "./GuardrailGlob";

/** 複数ルールのうち強い制限を残し、1つの allow で別の deny を解除しない。 */
export function addFinding(
	result: GuardResult,
	action: GuardAction,
	id: string,
	reason: string,
) {
	const strength = { allow: 0, ask: 1, deny: 2 };
	if (strength[action] > strength[result.action]) {
		result.action = action;
	}
	result.rules.push(id);
	result.reasons.push(reason);
}

/** 追加ルールはワークスペースを固定基準とし、例外は同じルール内だけで扱う。 */
function matchesRule(rule: PathRule, path: string, root: string): boolean {
	const base = root;
	if (!containsPath(base, path)) {
		return false;
	}
	const name = relative(base, path).replaceAll("\\", "/");
	if (rule.exceptions.some((pattern) => matchPath(pattern, name))) {
		return false;
	}
	if (rule.match === "glob") {
		return matchPath(rule.pattern, name);
	}
	const target = resolve(base, rule.pattern);
	return containsPath(target, path);
}

/** 設定自身と DLC 管理領域への書き込みは、追加ルールでは緩和しない。 */
function builtinProtection(
	path: string,
	roots: string[],
	operation: "read" | "write",
): string | undefined {
	/** 検査対象が、指定ルート内の DLC 管理領域に属するかを判定する。 */
	const isManagedDlcTarget = (root: string) =>
		isManagedDlcPath(relative(root, path).replaceAll("\\", "/"));
	const protectedDlcWrite =
		operation === "write" && roots.some(isManagedDlcTarget);
	if (protectedDlcWrite) {
		return "DLC の管理ファイルは Host が更新します。";
	}
	const matchesOperation2 =
		operation === "write" &&
		roots.some(
			(root) =>
				relative(resolve(root, ".pi/guardrails.json"), path) === "",
		);
	if (matchesOperation2) {
		return "ガードレール設定は専用エディターから変更してください。";
	}
	return undefined;
}

/** ワークスペース境界は cwd ではなく固定ルートで判定する。 */
export async function inspectGuardPath(
	config: GuardrailsConfig,
	root: string,
	roots: string[],
	cwd: string,
	input: string,
	operation: "read" | "write",
	result: GuardResult,
) {
	const lexical = resolve(cwd, input);
	const canonical = await canonicalPath(input, cwd);
	result.paths.push(canonical);
	const paths = [...new Set([lexical, canonical])];
	for (const definition of builtinPathDefinitions) {
		const matches = paths.some((path) => {
			const name = path.replaceAll("\\", "/");
			return (
				definition.patterns.some((pattern) =>
					matchPath(pattern, name),
				) &&
				!definition.exceptions.some((pattern) =>
					matchPath(pattern, name),
				)
			);
		});
		if (matches) {
			addFinding(
				result,
				config.builtins.paths[definition.id],
				`builtin:path:${definition.id}`,
				definition.name,
			);
		}
	}
	for (const path of paths) {
		const protectedReason = builtinProtection(path, roots, operation);
		if (isNonEmptyString(protectedReason)) {
			addFinding(result, "deny", "builtin:protected", protectedReason);
		}
	}
	const matching = config.pathRules.filter(
		(rule) =>
			rule.operations.includes(operation) &&
			paths.some((path) => matchesRule(rule, path, root)),
	);
	const outside = paths.some(
		(path) => !roots.some((workspace) => containsPath(workspace, path)),
	);
	if (outside) {
		let action: GuardAction = config.pathAccess.outsideRead;
		if (operation === "write") {
			action = "deny";
		}
		addFinding(
			result,
			action,
			"builtin:outside",
			`ワークスペース外への${operation === "read" ? "読み取り" : "書き込み"}です。`,
		);
	}
	for (const rule of matching) {
		addFinding(result, rule.action, rule.id, rule.reason);
	}
}
