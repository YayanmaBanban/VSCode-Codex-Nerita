// 双方向 JSONL を処理し、保留 RPC・切断・未対応のサーバー要求を管理する。
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { RequestId } from "../../../codex-app-server/RequestId";
import type { ClientNotification } from "../../../codex-app-server/ClientNotification";
import { stopAppServerProcess } from "./AppServerProcess";
import { parseRpcMessage, type AppServerNotification } from "../protocol/rpcMessage";
import { ServerRequests, type ServerRequestHandler } from "../ServerRequests";
import {
	responseParsers,
	type AppServerParams,
	type AppServerResponses,
} from "../protocol/responses";

/** RPC ごとの期限と、応答の受け渡し先。 */
type Pending = {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};
/** 生のプロトコルデータを Webview へ流さない Host 用の通知先。 */
export type AppServerCallbacks = {
	request?: ServerRequestHandler;
	notification?: (message: AppServerNotification) => void;
	disconnected?: (error: Error) => void;
};

/** 一つのプロセスに対する通信を順番通り処理する。 */
export class AppServerTransport {
	private nextId = 1;
	private readonly pending = new Map<RequestId, Pending>();
	private readonly lines: Interface;
	private readonly serverRequests: ServerRequests;
	private closed = false;
	private stopping: Promise<void> | undefined;

	/** 送信より前に全受信・終了ハンドラーを登録する。 */
	constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly callbacks: AppServerCallbacks = {},
		private readonly timeoutMs = 30_000,
	) {
		this.serverRequests = new ServerRequests((message) => {
			try {
				this.write(message);
			} catch {
				this.fail(new Error("Codex App Server へ回答できません。"));
			}
		}, callbacks.request);
		this.lines = createInterface({ input: child.stdout });
		this.lines.on("line", (line) => {
			if (this.closed) {
				return;
			}
			try {
				this.receive(JSON.parse(line));
			} catch {
				this.fail(
					new Error("Codex App Server の受信データが不正です。"),
				);
			}
		});
		this.lines.on("close", () =>
			this.fail(new Error("Codex App Server の出力が終了しました。")),
		);
		child.on("error", () =>
			this.fail(new Error("Codex App Server を起動できません。")),
		);
		child.on("exit", () =>
			this.fail(new Error("Codex App Server が終了しました。")),
		);
		child.stdin.on("error", () =>
			this.fail(new Error("Codex App Server へ送信できません。")),
		);
		child.stdout.on("error", () =>
			this.fail(new Error("Codex App Server から受信できません。")),
		);
		child.stderr.on("error", () =>
			this.fail(new Error("Codex App Server の診断出力が終了しました。")),
		);
		// 診断ログにはユーザー情報が含まれ得るため、記録せずパイプを排出する。
		child.stderr.resume();
	}

	/** メソッドとパラメーター・応答型を結び付け、送信前に待機先を確保する。 */
	request<M extends keyof AppServerResponses>(
		method: M,
		params: AppServerParams<M>,
	): Promise<AppServerResponses[M]> {
		if (this.closed) {
			return Promise.reject(
				new Error("Codex App Server は切断されています。"),
			);
		}
		const id = this.nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(
				() =>
					this.fail(
						new Error(
							"Codex App Server の応答がタイムアウトしました。",
						),
					),
				this.timeoutMs,
			);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.write({ id, method, params });
			} catch {
				this.fail(new Error("Codex App Server へ送信できません。"));
			}
		}).then(responseParsers[method]);
	}

	/** 初期化完了通知など、応答を伴わないメッセージを送る。 */
	notify(message: ClientNotification): void {
		this.write(message);
	}

	/** JSON-RPC のバージョンヘッダーを付けず、各メッセージを一行で送信する。 */
	private write(message: unknown): void {
		if (this.closed) {
			throw new Error("Codex App Server は切断されています。");
		}
		this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
			if (error) {
				this.fail(new Error("Codex App Server へ送信できません。"));
			}
		});
	}

	/** 検証済みの外形に従い、通知・未対応要求・応答を振り分ける。 */
	private receive(value: unknown): void {
		const message = parseRpcMessage(value);
		if (message.kind === "notification") {
			if (message.notification.method === "serverRequest/resolved") {
				this.serverRequests.resolved(message.notification.params);
			}
			this.callbacks.notification?.(message.notification);
			return;
		}
		if (message.kind === "request") {
			this.serverRequests.accept(message.request);
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		clearTimeout(pending.timer);
		if (message.error) {
			pending.reject(message.error);
		} else {
			pending.resolve(message.result);
		}
	}

	/** 通信異常は一度だけ通知し、プロセスと保留要求をまとめて終了する。 */
	private fail(error: Error): void {
		if (this.closed) {
			return;
		}
		void this.dispose(error);
		this.callbacks.disconnected?.(error);
	}

	/** 二重終了を許容し、すべての待機先を直ちに失敗させる。 */
	dispose(
		error = new Error("Codex App Server の接続を終了しました。"),
	): Promise<void> {
		if (this.stopping) {
			return this.stopping;
		}
		this.closed = true;
		this.serverRequests.dispose();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.lines.close();
		this.stopping = stopAppServerProcess(this.child);
		return this.stopping;
	}
}
