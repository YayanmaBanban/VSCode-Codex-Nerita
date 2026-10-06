// Windows のコマンド実行で、停止要求を子孫プロセスへ一度だけ伝える。
import { execFile, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";

/**
 * `taskkill` の完了後も子プロセスが終了していない場合は直接終了させる。
 * 停止後の結果は、呼び出し側で `close` イベントを待って確定する。
 */
export function createProcessTreeStopper(child: ChildProcess): () => void {
	let stopping = false;
	return () => {
		if (stopping || !isNonZeroNumber(child.pid)) {
			return;
		}
		stopping = true;
		execFile(
			join(process.env.SystemRoot!, "System32", "taskkill.exe"),
			["/PID", String(child.pid), "/T", "/F"],
			{ windowsHide: true, timeout: 5000 },
			() => {
				if (child.exitCode === null && child.signalCode === null) {
					child.kill();
				}
			},
		);
	};
}
