// Hostの固定スクリプトでMSIX版も含むPowerShellの絶対パスを解決する。
import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { promisify } from "node:util";

/** この探索はagent commandではなく、承認前のHost実行環境検出だけを行う。 */
export async function resolvePowerShell(): Promise<string> {
	if (process.platform !== "win32") {
		throw new Error("Pi SandboxはWindowsのみ対応しています。");
	}
	const windowsShell = join(
		process.env.SystemRoot || "C:\\Windows",
		"System32/WindowsPowerShell/v1.0/powershell.exe",
	);
	const candidates = [
		join(
			process.env.ProgramFiles || "C:\\Program Files",
			"PowerShell/7/pwsh.exe",
		),
	];
	try {
		const { stdout } = await promisify(execFile)(
			windowsShell,
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"(Get-Command pwsh.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source",
			],
			{
				windowsHide: true,
				timeout: 5000,
				cwd: process.env.SystemRoot || "C:\\Windows",
			},
		);
		// MSIX版は別ユーザーであるWindows Sandboxから起動できない。
		if (
			isAbsolute(stdout.trim()) &&
			!/[\\/]WindowsApps[\\/]/i.test(stdout.trim())
		) {
			candidates.push(stdout.trim());
		}
	} catch {
		/* PowerShell 7がない場合はWindows PowerShellを使う。 */
	}
	candidates.push(windowsShell);
	for (const path of candidates) {
		try {
			await access(path);
			return await realpath(path);
		} catch {
			/* 次の既知配置を確認する。 */
		}
	}
	throw new Error("PowerShell実行ファイルが見つかりません。");
}
