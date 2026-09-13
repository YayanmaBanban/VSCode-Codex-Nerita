// ACP の子プロセスと SDK 接続を管理する。生の診断出力に秘密情報を残さない。
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
	client,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from "@agentclientprotocol/sdk";

/** UI から独立した ACP の通知受付。 */
export type AcpCallbacks = {
	update: (notification: SessionNotification) => void;
	permission: (
		request: RequestPermissionRequest,
	) => Promise<RequestPermissionResponse>;
	disconnected: () => void;
};
/** セッション管理が利用する最小の通信インターフェース。 */
export type AcpTransport = ReturnType<typeof createTransport>;
/** 固定の adapter をシェルを経由せず起動し、プロセスごとの接続を返す。 */
export function createTransport(
	nodePath: string,
	adapterPath: string,
	cwd: string,
	callbacks: AcpCallbacks,
	log: (message: string) => void,
) {
	// adapter が内部で任意のパスや認証 JSON を解釈する環境変数は引き継がない。
	const env: NodeJS.ProcessEnv = {
		...process.env,
		INITIAL_AGENT_MODE: "agent",
	};
	for (const key of [
		"CODEX_PATH",
		"CODEX_CONFIG",
		"DEFAULT_AUTH_REQUEST",
		"APP_SERVER_LOGS",
		"NODE_OPTIONS",
		"ELECTRON_RUN_AS_NODE",
	]) {
		delete env[key];
	}
	const child = spawn(nodePath, [adapterPath], {
		cwd,
		env,
		windowsHide: true,
		detached: process.platform !== "win32",
		stdio: ["pipe", "pipe", "pipe"],
	});
	let disposed = false;
	let reported = false;
	/** 異常終了を一度だけ上位へ通知する。 */
	const disconnected = () => {
		if (!disposed && !reported) {
			reported = true;
			log("ACP 接続が終了しました。");
			callbacks.disconnected();
		}
	};
	child.stderr.on("data", () => {
		/* 生ログは認証情報を含み得るため保存しない。 */
	});
	child.on("error", disconnected);
	child.on("exit", disconnected);
	child.stdin.on("error", disconnected);
	const connection = client()
		.onNotification("session/update", ({ params }) => {
			if (!disposed) {
				callbacks.update(params);
			}
		})
		.onRequest("session/request_permission", ({ params }) =>
			callbacks.permission(params),
		)
		.connect(
			ndJsonStream(
				Writable.toWeb(child.stdin),
				Readable.toWeb(child.stdout),
			),
		);
	connection.signal.addEventListener("abort", disconnected, { once: true });
	/** 終了時に孫プロセスも終了し、すべての保留 RPC を失敗させる。 */
	function dispose(): Promise<void> {
		if (disposed) {
			return Promise.resolve();
		}
		disposed = true;
		const pid = child.pid;
		const killed = new Promise<void>((resolve) => {
			if (!pid || child.exitCode !== null) {
				resolve();
				return;
			}
			if (process.platform === "win32") {
				const killer = spawn(
					"taskkill.exe",
					["/PID", String(pid), "/T", "/F"],
					{ windowsHide: true, stdio: "ignore" },
				);
				killer.once("error", () => {
					child.kill();
					resolve();
				});
				killer.once("exit", () => resolve());
			} else {
				try {
					process.kill(-pid, "SIGKILL");
				} catch {
					child.kill();
				}
				resolve();
			}
		});
		connection.close();
		return killed.finally(() => {
			child.stdin.destroy();
			child.stdout.destroy();
			child.stderr.destroy();
		});
	}
	/** 応答しない初期化・認証が接続を永久に占有しないよう期限を設ける。 */
	async function bounded<T>(
		operation: Promise<T>,
		milliseconds = 30_000,
	): Promise<T> {
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				operation,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						reject(new Error("ACP timeout"));
						void dispose();
					}, milliseconds);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}
	return {
		initialize: () =>
			bounded(
				connection.agent.request("initialize", {
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {},
					clientInfo: { name: "vscode-codex-acp", version: "0.0.1" },
				}),
			),
		newSession: () =>
			bounded(
				connection.agent.request("session/new", {
					cwd,
					mcpServers: [],
				}),
			),
		authenticate: (methodId: string) =>
			bounded(
				connection.agent.request("authenticate", { methodId }),
				180_000,
			),
		prompt: (sessionId: string, text: string) =>
			connection.agent.request("session/prompt", {
				sessionId,
				prompt: [{ type: "text", text }],
			}),
		cancel: (sessionId: string) =>
			connection.agent.notify("session/cancel", { sessionId }),
		dispose,
	};
}
