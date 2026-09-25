// コマンド内の既知の危険操作を検出する。動的な実行内容は推測で許可しない。
import type { GuardrailsConfig } from "../../shared/guardrails/config";
import type { GuardResult } from "../../shared/guardrails/messages";
import { addFinding, inspectGuardPath } from "./GuardrailPaths";
import { homedir } from "node:os";
import { join } from "node:path";

/** Shell 本文は実行せず検査し、解析の限界も承認画面へ伝える。 */
export async function inspectGuardCommand(
	config: GuardrailsConfig,
	root: string,
	roots: string[],
	cwd: string,
	shell: string,
	command: string,
	result: GuardResult,
) {
	addFinding(
		result,
		"ask",
		"builtin:shell",
		"Shellの実行には1回限りの承認が必要です。",
	);
	if (
		/(?:remove-item|\brm\b|\brmdir\b|\bdel\b)|\bgit\s+(?:clean\b|reset\b[^\r\n;|]*--hard)/i.test(
			command,
		)
	) {
		addFinding(
			result,
			"ask",
			"builtin:destructive",
			"削除または変更の破棄を含むコマンドです。",
		);
	}
	for (const rule of config.commandRules) {
		if (
			(rule.shell === "any" || rule.shell === shell) &&
			command.toLowerCase().includes(rule.pattern.toLowerCase())
		) {
			addFinding(result, rule.action, rule.id, rule.reason);
		}
	}
	await inspectLiteralPaths(config, root, roots, cwd, command, result);
	result.uncertainties.push(
		"変数・スクリプト・別プログラム内部のファイルアクセスは完全には解析できません。",
	);
}

/** 単純なパス表記だけを取り出し、不明な展開を許可の根拠にしない。 */
async function inspectLiteralPaths(
	config: GuardrailsConfig,
	root: string,
	roots: string[],
	cwd: string,
	command: string,
	result: GuardResult,
) {
	// 単純なリテラルを対象にする。スクリプト・変数・子プロセス内部のアクセスまでは保証しない。
	const tokens =
		command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[;|&\n]|[^\s;|&()<>]+/g) ?? [];
	let operation: "read" | "write" = "read";
	for (const [index, raw] of tokens.slice(0, 256).entries()) {
		const token = raw.replace(/^['"]|['"]$/g, "");
		operation = pathOperation(token, operation);
		if (!literalPath(token, tokens[index - 1])) {
			continue;
		}
		const target = token.startsWith("~")
			? join(homedir(), token.slice(2))
			: token;
		try {
			await inspectGuardPath(
				config,
				root,
				roots,
				cwd,
				target,
				operation,
				result,
			);
		} catch {
			addFinding(
				result,
				"ask",
				"builtin:unresolved-path",
				`パスを解決できません: ${token}`,
			);
		}
	}
}

/** リテラルと判断できるパス表記・パス引数を拾い、変数や式は承認へ残す。 */
function literalPath(token: string, previous: string | undefined): boolean {
	if (/[$`{}*?]/.test(token) || token.startsWith("-")) {
		return false;
	}
	return (
		/^(?:[a-z]:[\\/]|[\\/]{2}|\.{1,2}[\\/]|~[\\/]|\/|\.env|\.ssh)/i.test(
			token,
		) ||
		/^(?:get-content|gc|cat|type|set-content|add-content|out-file|remove-item|rm|move-item|copy-item|-literalpath|-path|-destination)$/i.test(
			previous ?? "",
		)
	);
}

/** 既知の書込みコマンドは外部 read の例外で通過させない。 */
function pathOperation(
	token: string,
	previous: "read" | "write",
): "read" | "write" {
	if (/^[;|&\n]$/.test(token)) {
		return "read";
	}
	if (
		/^(?:set-content|add-content|out-file|remove-item|rm|rmdir|del|move-item|copy-item|mv|cp|new-item|mkdir)$/i.test(
			token,
		)
	) {
		return "write";
	}
	return previous;
}
