// 端末用プロセスの起動と、Windowsを含むプロセスツリーの停止を扱う。
import { spawn, type ChildProcess } from "node:child_process";

/** 自分が起動したプロセスの子孫も停止し、停止失敗を呼び出し元へ返す。 */
export async function killTree(child: ChildProcess): Promise<void> {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	if (process.platform !== "win32") {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
				throw error;
			}
		}
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const killer = spawn(
			"taskkill.exe",
			["/PID", String(child.pid), "/T", "/F"],
			{ windowsHide: true, stdio: "ignore" },
		);
		killer.once("error", reject);
		killer.once("exit", (code) => {
			if (
				code === 0 ||
				child.exitCode !== null ||
				child.signalCode !== null
			) {
				resolve();
			} else {
				reject(new Error("Terminal termination failed"));
			}
		});
	});
}
