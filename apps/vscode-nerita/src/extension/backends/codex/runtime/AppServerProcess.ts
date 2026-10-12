// シェルを介さず App Server を起動し、接続終了時にプロセスツリーを解放する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { WindowsSandboxSetupMode } from "../codex-app-server/v2/WindowsSandboxSetupMode";
import { sandboxServerEnvironment } from "../../../runtime/CommandEnvironment";
import { BackendShutdownError } from "../../../session/BackendShutdown";

/** 認証・`CODEX_HOME`・設定を継承し、同梱ネイティブ実行ファイルを起動する。 */
export function startAppServerProcess(
	executable: string,
	cwd: string,
	windowsSandbox?: WindowsSandboxSetupMode,
): ChildProcessWithoutNullStreams {
	const env =
		windowsSandbox !== undefined
			? sandboxServerEnvironment()
			: { ...process.env };
	// Extension Host 固有の Node 起動設定を、Codex が起動する子プロセスへ持ち込まない。
	delete env.NODE_OPTIONS;
	delete env.ELECTRON_RUN_AS_NODE;
	const args = ["app-server", "--listen", "stdio://"];
	if (windowsSandbox !== undefined) {
		args.push("-c", `windows.sandbox="${windowsSandbox}"`);
		// config.toml 内の `env` 追加・`shell` 起動フックを専用接続へ持ち込まない。
		args.push(
			"-c",
			'shell_environment_policy.inherit="none"',
			"-c",
			"shell_environment_policy.set={}",
		);
	}
	return spawn(executable, args, {
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
	await stopRunningAppServer(child);
	child.stdin.destroy();
	child.stdout.destroy();
	child.stderr.destroy();
}

/** 起動していないプロセスと終了済みプロセスは待機せず、動作中のときだけ終了通知を待つ。 */
async function stopRunningAppServer(
	child: ChildProcessWithoutNullStreams,
): Promise<void> {
	if (!isNonZeroNumber(child.pid)) {
		return;
	}
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	/** 待機は通知が来るまで完了せず、二度の期限切れでも成功と扱わない。 */
	const waitForExit = (
		resolve: () => void,
		reject: (reason: unknown) => void,
	) => {
		let forced = false;
		/** 終了通知と監視タイマーを一度だけ解放する。 */
		const done = () => {
			clearTimeout(timer);
			child.off("exit", done);
			resolve();
		};
		/** kill の受付は終了確認ではない。再試行後にも通知がなければ予約を保持させる。 */
		const timeout = () => {
			if (!forced) {
				forced = true;
				timer = setTimeout(timeout, 5000);
				child.kill();
				return;
			}
			child.off("exit", done);
			reject(
				new BackendShutdownError(
					new Error("Codex App Server の終了通知がありません。"),
				),
			);
		};
		let timer = setTimeout(timeout, 5000);
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
	};
	await new Promise<void>(waitForExit);
}
