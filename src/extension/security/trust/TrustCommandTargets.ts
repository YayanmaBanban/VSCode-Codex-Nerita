// コマンドに明示された実行対象を拾い、cwd の信頼を外部パスへ流用しない。
import { resolve } from "node:path";
import type { ToolCall } from "../ApprovedToolCall";

/** 動的な作業場所や文字列からの追加実行は推測で許可しない。 */
export function commandTrustTargets(call: ToolCall): string[] {
	if (!call.command && !call.hostShell) {
		return [];
	}
	const command = checkedCommand(call.params.command);
	const tokens =
		command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s;|&()<>]+/g) ?? [];
	if (tokens.length > 256) {
		throw new Error("コマンドのTrust対象が多すぎます。");
	}
	const targets: string[] = [];
	for (const [index, raw] of tokens.entries()) {
		const token = raw.replace(/^['"]|['"]$/g, "");
		const previous = tokens[index - 1] ?? "";
		if (!isPathArgument(token, previous)) {
			continue;
		}
		if (/[$`{}*?]/.test(token) || token.startsWith("~")) {
			throw new Error("動的な対象パスのTrustを解決できません。");
		}
		targets.push(resolve(call.cwd, token));
	}
	return targets;
}

/** 解析対象にできない実行形式を先に拒否する。 */
function checkedCommand(command: unknown): string {
	if (typeof command !== "string") {
		throw new Error("実行対象のコマンド本文を解決できません。");
	}
	if (
		/\b(?:invoke-expression|iex|encodedcommand|frombase64string)\b|(?:&|\.)\s*[$(]/i.test(
			command,
		)
	) {
		throw new Error("動的なコード実行のTrustを解決できません。");
	}
	if (/\bgit\s+(?:[^\r\n;|]*\s)?clone\b/i.test(command)) {
		throw new Error(
			"外部repoの取得には出所を登録するWeb取得経路を使用してください。",
		);
	}
	return command;
}

/** 明示パス、スクリプト、作業先を指定する引数を対象にする。 */
function isPathArgument(token: string, previous: string): boolean {
	if (/^-/.test(token)) {
		return false;
	}
	return (
		/^(?:[a-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~[\\/])/i.test(token) ||
		/[\\/]|\.(?:ps1|bat|cmd|exe|js|mjs|cjs|py|sh)$/i.test(token) ||
		/^(?:cd|chdir|set-location|push-location|-file|-path|-literalpath|--dir|--prefix|-c)$/i.test(
			previous,
		)
	);
}
