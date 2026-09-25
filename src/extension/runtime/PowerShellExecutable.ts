// Shell名に対応する実行ファイルを環境から解決し、別のShellへ自動切替しない。
import { access, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

/** Tool名と実行ファイルを承認前に対応付ける。 */
export type PowerShellKind = "powershell" | "pwsh";
export type PowerShellExecutable = { name: PowerShellKind; executable: string };

/** pwshの利用確認には、呼出元が所有するSandbox接続を使用する。 */
export async function resolvePowerShell(
	name: PowerShellKind = "powershell",
	usable: (executable: string) => Promise<boolean> = () =>
		Promise.resolve(true),
): Promise<string> {
	if (process.platform !== "win32") {
		throw new Error(
			`${name}の実行ファイル探索は${process.platform}に対応していません。`,
		);
	}
	for (const path of candidates(name)) {
		const executable = await canonicalExecutable(path);
		if (executable && (await usable(executable))) {
			return executable;
		}
	}
	throw new Error(
		`${name}の利用可能な実行ファイルが見つかりません。未導入・MSIX配置・アクセス権を確認してください。`,
	);
}

/** Windows PowerShellはOSの配置、pwshは通常の導入先とPATHだけを探索する。 */
function candidates(name: PowerShellKind): string[] {
	if (name === "powershell") {
		const root = process.env.SystemRoot;
		if (!root || !isAbsolute(root)) {
			throw new Error("WindowsのSystemRootを解決できません。");
		}
		return [join(root, "System32/WindowsPowerShell/v1.0/powershell.exe")];
	}
	const directories = [
		...(process.env.ProgramFiles
			? [join(process.env.ProgramFiles, "PowerShell/7")]
			: []),
		...(process.env.PATH ?? "").split(delimiter),
	];
	return [
		...new Set(
			directories.filter(isAbsolute).map((dir) => join(dir, "pwsh.exe")),
		),
	];
}

/** App Execution Aliasやリンク先も検査し、Sandboxユーザーが使えないMSIX配置を除外する。 */
async function canonicalExecutable(path: string): Promise<string | undefined> {
	try {
		const executable = await realpath(path);
		if (
			[path, executable].some((value) =>
				/[\\/]WindowsApps[\\/]/i.test(value),
			)
		) {
			return undefined;
		}
		await access(executable);
		return executable;
	} catch {
		return undefined;
	}
}
