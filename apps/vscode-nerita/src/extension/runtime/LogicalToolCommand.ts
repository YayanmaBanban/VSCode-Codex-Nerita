// シェル文の推測ではなく構造化 argv を分類し、不明な構文は最も強い承認へ送る。
import type { CommandClass } from "@nerita/shared/commandPermission";

/** 実行ファイル形式は受け取らない。呼出し側が検出した論理ツール名と argv を渡す。 */
export function classifyToolCommand(
	tool: string,
	args: readonly string[],
): CommandClass {
	if (
		tool !== "pnpm" ||
		args.length === 0 ||
		args.some((arg) => /[\0\r\n]/.test(arg))
	) {
		return "installation-network";
	}
	if (args.length === 1 && ["--version", "-v"].includes(args[0]!)) {
		return "read-only-ish";
	}
	const [command, ...tail] = args;
	// --dir / --filter / --config.* などの前置オプションや未確認の構文は弱いクラスへ下げない。
	if (["run", "test", "build", "exec"].includes(command!)) {
		return "execution";
	}
	if (
		["list", "ls", "why", "root", "bin"].includes(command!) &&
		safeQueryArguments(tail)
	) {
		return "read-only-ish";
	}
	return "installation-network";
}

/** 照会に必要な既知オプションのみを許可し、設定・hook・作業先の上書きを照会扱いしない。 */
function safeQueryArguments(args: readonly string[]): boolean {
	return args.every(
		(arg) =>
			[
				"--json",
				"--long",
				"--parseable",
				"--prod",
				"--dev",
				"--global",
				"-g",
				"--recursive",
				"-r",
			].includes(arg) ||
			/^--depth=\d+$/.test(arg) ||
			/^(?:@[\w.-]+\/)?[a-z0-9][\w.-]*$/i.test(arg),
	);
}
