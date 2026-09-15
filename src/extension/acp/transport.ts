// ACP の子プロセスと SDK 接続を管理する。
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { StatusReader } from "./statusReader";
import { Terminals } from "./terminals";
import { orderedUpdates } from "./orderedUpdates";
import type { TerminalSnapshot } from "../../shared/toolTerminal";
import {
	client,
	methods,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
	type ContentBlock,
} from "@agentclientprotocol/sdk";

/** UI から独立した ACP の通知受付。 */
export type AcpCallbacks = {
	terminal?: (
		sessionId: string,
		terminalId: string,
		snapshot: TerminalSnapshot,
	) => void;
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
	const status = new StatusReader();
	const terminals = new Terminals(cwd, (sessionId, terminalId, snapshot) => {
		if (!disposed) {
			callbacks.terminal?.(sessionId, terminalId, snapshot);
		}
	});
	let cancelGeneration = 0;
	let reported = false;
	/** 異常終了を一度だけ上位へ通知する。 */
	const disconnected = () => {
		if (!disposed && !reported) {
			reported = true;
			log("ACP 接続が終了しました。");
			callbacks.disconnected();
		}
	};
	// 診断内容は記録せずに読み捨て、パイプの詰まりを防ぐ。
	child.stderr.resume();
	child.on("error", disconnected);
	child.on("exit", disconnected);
	child.stdin.on("error", disconnected);
	const ordered = orderedUpdates(
		ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
	);
	const connection = client()
		.onRequest(methods.client.terminal.create, ({ params }) =>
			terminals.create(params),
		)
		.onRequest(methods.client.terminal.output, ({ params }) =>
			terminals.output(params),
		)
		.onRequest(methods.client.terminal.waitForExit, ({ params }) =>
			terminals.waitForExit(params),
		)
		.onRequest(methods.client.terminal.kill, ({ params }) =>
			terminals.kill(params),
		)
		.onRequest(methods.client.terminal.release, ({ params }) =>
			terminals.release(params),
		)
		.onNotification("session/update", ({ params }) => {
			try {
				if (!disposed && !status.consume(params)) {
					callbacks.update(params);
				}
			} finally {
				ordered.handled();
			}
		})
		.onRequest("session/request_permission", ({ params }) =>
			callbacks.permission(params),
		)
		.connect(ordered.stream);
	connection.signal.addEventListener("abort", disconnected, { once: true });
	/** 終了時に孫プロセスも終了し、すべての保留 RPC を失敗させる。 */
	function dispose(): Promise<void> {
		if (disposed) {
			return Promise.resolve();
		}
		disposed = true;
		ordered.close();
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
		return Promise.all([killed, terminals.dispose()])
			.then(() => undefined)
			.finally(() => {
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
					clientCapabilities: {
						terminal: true,
						_meta: {
							terminal_output: true,
						},
					},
					clientInfo: { name: "vscode-codex-acp", version: "0.0.1" },
				}),
			),
		newSession: async () => {
			const session = await bounded(
				connection.agent.request("session/new", {
					cwd,
					mcpServers: [],
				}),
			);
			terminals.allowSession(session.sessionId);
			return session;
		},
		authenticate: (methodId: string) =>
			bounded(
				connection.agent.request("authenticate", { methodId }),
				180_000,
			),
		setConfig: (sessionId: string, configId: string, value: string) =>
			connection.agent.request("session/set_config_option", {
				sessionId,
				configId,
				value,
			}),
		prompt: (
			sessionId: string,
			text: string,
			attachments: ContentBlock[] = [],
		) => {
			const generation = cancelGeneration;
			return status.serial(() => {
				if (generation !== cancelGeneration || disposed) {
					throw new Error("cancelled");
				}
				return connection.agent.request("session/prompt", {
					sessionId,
					prompt: [{ type: "text", text }, ...attachments],
				});
			});
		},
		readStatus: (sessionId: string) =>
			status.read(
				sessionId,
				() =>
					bounded(
						connection.agent.request("session/prompt", {
							sessionId,
							prompt: [{ type: "text", text: "/status" }],
						}),
						10_000,
					).catch((error: unknown) => {
						// タイムアウトで接続を破棄した場合、UIにも切断を知らせる。
						if (disposed) {
							callbacks.disconnected();
						}
						throw error;
					}),
				log,
			),
		cancel: (sessionId: string) => {
			cancelGeneration++;
			return connection.agent.notify("session/cancel", { sessionId });
		},
		killTerminal: (sessionId: string, terminalId: string) =>
			terminals.kill({ sessionId, terminalId }),
		terminalSnapshot: (sessionId: string, terminalId: string) =>
			terminals.snapshot({ sessionId, terminalId }),
		dispose,
	};
}
