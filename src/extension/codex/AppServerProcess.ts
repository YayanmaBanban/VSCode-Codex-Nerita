// シェルを介さず App Server を起動し、接続終了時にプロセスツリーを解放する。
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** 認証・CODEX_HOME・設定を継承し、同梱ネイティブ実行ファイルを起動する。 */
export function startAppServerProcess(
	executable: string,
	cwd: string,
): ChildProcessWithoutNullStreams {
	const env = { ...process.env };
	// Extension Host 固有の Node 起動設定を、Codex が起動する子プロセスへ持ち込まない。
	delete env.NODE_OPTIONS;
	delete env.ELECTRON_RUN_AS_NODE;
	return spawn(executable, ["app-server", "--listen", "stdio://"], {
		cwd,
		env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

/** 正常終了・起動失敗にも対応し、Windows では孫プロセスも終了する。 */
export async function stopAppServerProcess(
	child: ChildProcessWithoutNullStreams,
): Promise<void> {
	if (child.pid && child.exitCode === null && child.signalCode === null) {
		await new Promise<void>((resolve) => {
			/** 終了通知と監視タイマーを一度だけ解放する。 */
			const done = () => {
				clearTimeout(timer);
				child.off("exit", done);
				resolve();
			};
			const timer = setTimeout(() => {
				child.kill();
				done();
			}, 5000);
			child.once("exit", done);
			if (process.platform === "win32") {
				const killer = spawn(
					"taskkill.exe",
					["/PID", String(child.pid), "/T", "/F"],
					{
						windowsHide: true,
						stdio: "ignore",
					},
				);
				killer.once("error", () => {
					child.kill();
				});
				killer.once("exit", (code) => {
					if (code !== 0) {
						child.kill();
					}
				});
			} else {
				child.kill();
			}
		});
	}
	child.stdin.destroy();
	child.stdout.destroy();
	child.stderr.destroy();
}
