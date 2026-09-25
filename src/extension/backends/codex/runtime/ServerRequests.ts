// サーバー発の要求を通常 RPC と分け、取消・二重回答・切断後の送信を防ぐ。
import type { RequestId } from "../codex-app-server/RequestId";
import { isRecord } from "../../../../shared/validation";
import {
	AppServerRpcError,
	type AppServerRequest,
} from "../protocol/rpcMessage";

/** 承認などの要求に対し、生成型に沿った応答を作る Host ハンドラー。 */
export type ServerRequestHandler = (
	request: AppServerRequest,
	signal: AbortSignal,
) => Promise<unknown>;
/** 要求の待機と取消通知を管理する。 */
export class ServerRequests {
	private pending = new Map<
		RequestId,
		{ request: AppServerRequest; abort: AbortController }
	>();
	/** 送信先と UI の要求ハンドラーを保持する。 */
	constructor(
		private write: (message: unknown) => void,
		private handler?: ServerRequestHandler,
	) {}
	/** 1つの要求へ一度だけ結果かエラーを返す。 */
	accept(request: AppServerRequest): void {
		if (this.pending.has(request.id)) {
			throw new Error("Duplicate server request");
		}
		const entry = { request, abort: new AbortController() };
		this.pending.set(request.id, entry);
		void Promise.resolve()
			.then(() => {
				if (entry.abort.signal.aborted) {
					return undefined;
				}
				if (!this.handler) {
					throw new AppServerRpcError(
						-32601,
						"Method not supported by this client",
					);
				}
				return this.handler(request, entry.abort.signal);
			})
			.then(
				(result) => this.finish(request.id, entry.abort, { result }),
				(error: unknown) =>
					this.finish(request.id, entry.abort, {
						error: {
							code:
								error instanceof AppServerRpcError
									? error.code
									: -32603,
							message:
								error instanceof AppServerRpcError
									? error.message
									: "Client request failed",
						},
					}),
			);
	}
	/** サーバー側で解決済みの要求は UI から除去し、遅い回答を送信しない。 */
	resolved(params: unknown): void {
		if (
			!isRecord(params) ||
			(typeof params.requestId !== "string" &&
				typeof params.requestId !== "number")
		) {
			return;
		}
		const entry = this.pending.get(params.requestId);
		if (
			entry &&
			isRecord(entry.request.params) &&
			entry.request.params.threadId === params.threadId
		) {
			this.pending.delete(params.requestId);
			entry.abort.abort();
		}
	}
	/** 接続終了時は全ハンドラーに取消を知らせる。 */
	dispose(): void {
		const entries = [...this.pending.values()];
		this.pending.clear();
		for (const entry of entries) {
			entry.abort.abort();
		}
	}
	/** 同じ要求がまだ保留中の場合だけ、通信へ回答を渡す。 */
	private finish(
		id: RequestId,
		abort: AbortController,
		response: object,
	): void {
		if (this.pending.get(id)?.abort !== abort) {
			return;
		}
		this.pending.delete(id);
		this.write({ id, ...response });
	}
}
