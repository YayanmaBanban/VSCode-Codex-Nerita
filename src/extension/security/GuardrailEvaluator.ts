// エディターの検査と実際の Tool Call が同じ判定を使用する。
import type { GuardrailsConfig } from "../../shared/guardrails/config";
import type { GuardProbe, GuardResult } from "../../shared/guardrails/messages";
import { inspectGuardPath, addFinding } from "./GuardrailPaths";
import { inspectGuardCommand } from "./GuardrailCommands";
import { canonicalPath } from "./WorkspacePathPolicy";
import { containsPath } from "./AgentAccessPolicy";

/** 検査だけを実施し、対象のコマンドやファイルへの変更は実行しない。 */
export async function evaluateGuardrails(
	config: GuardrailsConfig,
	root: string,
	roots: string[],
	probe: GuardProbe,
): Promise<GuardResult> {
	const result: GuardResult = {
		action: "allow",
		reasons: [],
		rules: [],
		paths: [],
		uncertainties: [],
	};
	try {
		const cwd = await canonicalPath(probe.cwd || ".", root);
		if (!roots.some((workspace) => containsPath(workspace, cwd))) {
			addFinding(
				result,
				"deny",
				"builtin:cwd",
				"cwdがworkspace境界外です。",
			);
			return result;
		}
		if (["powershell", "pwsh", "bash"].includes(probe.tool)) {
			await inspectGuardCommand(
				config,
				root,
				roots,
				cwd,
				probe.tool,
				probe.input,
				result,
			);
		} else if (probe.tool === "extension") {
			addFinding(
				result,
				"ask",
				"builtin:extension",
				"拡張ToolはHost権限で動作するため承認が必要です。",
			);
			result.uncertainties.push(
				"任意の拡張コード内部のアクセスは検査できません。",
			);
		} else {
			const operation = ["write", "edit"].includes(probe.tool)
				? "write"
				: "read";
			await inspectGuardPath(
				config,
				root,
				roots,
				cwd,
				probe.input || ".",
				operation,
				result,
			);
			if (operation === "write") {
				addFinding(
					result,
					"ask",
					"builtin:write",
					"ファイルの変更には1回限りの承認が必要です。",
				);
			}
		}
	} catch (error) {
		addFinding(
			result,
			"deny",
			"builtin:invalid-path",
			error instanceof Error ? error.message : "パスを解決できません。",
		);
	}
	result.paths = [...new Set(result.paths)];
	return result;
}

/** 同じ条件で結果が異なるルールを設定検査で知らせる。実行時は強い制限を優先する。 */
export function guardrailWarnings(config: GuardrailsConfig): string[] {
	const warnings: string[] = [];
	const rules = [...config.pathRules, ...config.commandRules];
	for (let i = 0; i < rules.length; i++) {
		const rule = rules[i]!;
		for (const other of rules.slice(i + 1)) {
			if (
				rule.pattern === other.pattern &&
				rule.action !== other.action &&
				rule.match === other.match
			) {
				warnings.push(
					`${rule.id} と ${other.id} は同じパターンで判定が異なります。deny > ask > allow を優先します。`,
				);
			}
		}
	}
	return warnings;
}
