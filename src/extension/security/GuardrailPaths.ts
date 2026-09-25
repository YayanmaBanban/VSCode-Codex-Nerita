// パスの表記と実体を両方検査し、リンク経由の保護対象へのアクセスも判定する。
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import type {
	GuardrailsConfig,
	GuardAction,
	PathRule,
} from "../../shared/guardrails/config";
import type { GuardResult } from "../../shared/guardrails/messages";
import { canonicalPath } from "./WorkspacePathPolicy";
import { containsPath } from "./AgentAccessPolicy";
import { matchPath } from "./GuardrailGlob";
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

/** ファイルは完全一致、ディレクトリは境界付きで比較する。例外は同じルール内だけ。 */
function matchesRule(rule: PathRule, path: string, root: string): boolean {
	const base = rule.base === "home" ? homedir() : root;
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
	return rule.match === "directory"
		? containsPath(target, path)
		: relative(target, path) === "";
}

/** 設定自体の書換えと秘密鍵のアクセスは、workspace の追加ルールでは緩和しない。 */
function builtinProtection(
	path: string,
	roots: string[],
	operation: "read" | "write",
): string | undefined {
	const parts = path.replaceAll("\\", "/").toLowerCase().split("/");
	if (
		parts.some((part) => [".ssh", ".aws", ".gnupg"].includes(part)) ||
		parts.at(-1) === ".git-credentials"
	) {
		return "認証情報の保護対象です。";
	}
	if (
		operation === "write" &&
		roots.some(
			(root) =>
				relative(resolve(root, ".pi/guardrails.json"), path) === "",
		)
	) {
		return "ガードレール設定は専用エディターから変更してください。";
	}
	return undefined;
}

/** workspace 境界は cwd ではなく固定ルートで判定する。 */
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
	for (const path of paths) {
		const protectedReason = builtinProtection(path, roots, operation);
		if (protectedReason) {
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
		// 明示したパス単位の例外だけが外部 read の既定を置き換える。write の上限は変えない。
		const canonicalRules = matching.filter((rule) =>
			matchesRule(rule, canonical, root),
		);
		let action: GuardAction = canonicalRules.length
			? "allow"
			: config.pathAccess.outsideRead;
		if (operation === "write") {
			action = "deny";
		}
		addFinding(
			result,
			action,
			"builtin:outside",
			`workspace外への${operation === "read" ? "読取り" : "書込み"}です。`,
		);
	}
	for (const rule of matching) {
		addFinding(result, rule.action, rule.id, rule.reason);
	}
}
