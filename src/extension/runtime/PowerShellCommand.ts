// 承認と実行で同じ平文argvを使い、文字コードの初期化もsnapshotへ含める。
import type { PowerShellExecutable } from "./PowerShellExecutable";

/** Console設定がSandboxに拒否されても通常実行は維持し、未適用を出力に残す。 */
function utf8Setup(): string[] {
	return [
		// PowerShell側で出力を捨てると旧CodePageがcacheされるため、固定のcmd内で抑制する。
		// 制約言語は維持し、ConsoleのコードページだけをWindows標準コマンドで設定する。
		'& "$env:SystemRoot\\System32\\cmd.exe" /d /c \'"%SystemRoot%\\System32\\chcp.com" 65001 >nul\'',
		...[
			"$OutputEncoding",
			"[Console]::InputEncoding",
			"[Console]::OutputEncoding",
		].map(
			(target) =>
				`try { ${target} = [System.Text.Encoding]::UTF8 } catch { if (${target}.CodePage -ne 65001) { Write-Warning ('Nerita: ${target} UTF-8 was not applied: ' + $_.FullyQualifiedErrorId) } }`,
		),
	];
}

/** 本文は単一引数。profile・ExecutionPolicy変更・暗黙のBase64化は使用しない。 */
export function powerShellCommand(
	shell: PowerShellExecutable,
	body: string,
): string[] {
	return [
		shell.executable,
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-OutputFormat",
		"Text",
		"-Command",
		[
			"$ProgressPreference = 'SilentlyContinue'",
			...(shell.name === "powershell" ? utf8Setup() : []),
			body,
		].join("\n"),
	];
}
