// 明示的な OS 環境で専用プロセスを起動し、実行設定は標準入力だけで渡す。
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { ContainerConfig } from "@microsoft/mxc-sdk";
import { commandEnvironment } from "./CommandEnvironment";
import type { MxcSdk } from "./MxcSdk";

/** 秘密値を含む設定を、コマンドライン・ファイル・ランチャーの環境へ載せない。 */
export function spawnMxcLauncher(
	sdk: MxcSdk,
	config: ContainerConfig,
	cwd: string,
) {
	const launch = sdk.resolveLaunch(config);
	if (launch.args.length !== 2 || launch.args[0] !== "--config-base64") {
		throw new Error("MXC SDK の起動引数が未対応の形式です。");
	}
	const env = Object.fromEntries(
		Object.entries(commandEnvironment()).filter(
			(entry): entry is [string, string] => entry[1] !== null,
		),
	);
	const child = spawn(
		join(
			process.env.SystemRoot!,
			"System32/WindowsPowerShell/v1.0/powershell.exe",
		),
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			sdk.launcherPath,
			"-Executable",
			launch.executablePath,
		],
		{
			cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	child.stdin.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code !== "EPIPE" && error.code !== "ECONNRESET") {
			child.emit("error", error);
		}
	});
	child.stdin.end(JSON.stringify(config), "utf8");
	return child;
}
