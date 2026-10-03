// 双方向 JSONL を処理し、保留 RPC・切断・未対応のサーバー要求を管理する。
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { AppServerJsonReader } from "./AppServerJsonReader";
import type { RequestId } from "../codex-app-server/RequestId";
import type { ClientNotification } from "../codex-app-server/ClientNotification";
import { stopAppServerProcess } from "./AppServerProcess";
import {
	parseRpcMessage,
	type AppServerNotification,
} from "../protocol/rpcMessage";
import { ServerRequests, type ServerRequestHandler } from "./ServerRequests";
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

/** 1つのプロセスに対する通信を順番通り処理する。 */
export class AppServerTransport {
	private nextId = 1;
	private readonly pending = new Map<RequestId, Pending>();
	private readonly reader: AppServerJsonReader;
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
		this.reader = new AppServerJsonReader(
			child.stdout,
			(value) => this.receive(value),
			(error) => this.fail(error),
		);
		child.on("error", () =>
			this.fail(new Error("Codex App Server を起動できません。")),
		);
		// exit 時に先回りして破棄せず、stdout の最終応答を Reader が読み終えてから終了する。
		child.stdin.on("error", () =>
			this.fail(new Error("Codex App Server へ送信できません。")),
		);
		child.stdout.on("error", () =>
			this.fail(new Error("Codex App Server から受信できません。")),
		);
		child.stderr.on("error", () =>
			this.fail(new Error("Codex App Server の診断出力が終了しました。")),
		);
		// 診断ログにはユーザー情報が含まれ得るため、標準エラー出力を記録せず読み捨てる。
		child.stderr.resume();
	}

	/** メソッドとパラメーター・応答型を結び付け、送信前に待機先を確保する。 */
	request<M extends keyof AppServerResponses>(
		method: M,
		params: AppServerParams<M>,
		timeoutMs = this.timeoutMs,
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
				timeoutMs,
			);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.write({ id, method, params });
			} catch {
				this.fail(new Error("Codex App Server へ送信できません。"));
			}
		}).then(responseParsers[method]);
	}

	/** 初期化の完了通知など、応答を伴わないメッセージを送る。 */
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
		this.stopping = Promise.all([
			this.reader.dispose(),
			stopAppServerProcess(this.child),
		]).then(() => undefined);
		return this.stopping;
	}
}
