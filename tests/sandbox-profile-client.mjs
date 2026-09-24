// 試験的な権限profileだけを検査するJSONLクライアント。製品のRPC型を拡張しない。
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** 一時CODEX_HOMEを子processだけに渡し、ユーザー設定と認証を読み込ませない。 */
export function sandboxProfileClient(executable, cwd, configHome, stopProcess) {
	const env = { ...process.env, CODEX_HOME: configHome };
	delete env.NODE_OPTIONS;
	delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
		cwd,
		env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stderr.resume();
	const pending = new Map();
	let sequence = 0;
	let closed = false;
	/** 起動失敗・切断時はすべての待機要求を終了させる。 */
	const fail = (error) => {
		closed = true;
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		pending.clear();
	};
	child.on("error", fail);
	child.on("exit", () => fail(new Error("Sandbox profile server exited")));
	child.stdin.on("error", fail);
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		try {
			const message = JSON.parse(line);
			const entry = pending.get(message.id);
			if (!entry) {
				return;
			}
			pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error) {
				entry.reject(
					Object.assign(new Error(message.error.message), {
						code: message.error.code,
					}),
				);
			} else {
				entry.resolve(message.result);
			}
		} catch (error) {
			fail(error);
		}
	});
	/** 任意のモデル・thread・セットアップ要求は呼び出さず、固定fixtureのRPCだけを使う。 */
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			if (closed) {
				reject(new Error("Sandbox profile connection closed"));
				return;
			}
			const id = ++sequence;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Sandbox profile RPC timed out: ${method}`));
			}, 15000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	return {
		request,
		/** initialize後の通知だけを送信する。 */
		initialized() {
			child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
		},
		/** 応答エラー時にも専用processを残さない。 */
		async dispose() {
			fail(new Error("Sandbox profile connection disposed"));
			lines.close();
			await stopProcess(child);
		},
	};
}
