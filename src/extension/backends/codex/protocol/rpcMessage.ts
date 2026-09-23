// JSONL の外側の形式を検証し、応答・通知・サーバー要求を区別する。
import type { RequestId } from "../codex-app-server/RequestId";
import { isRecord } from "../../../../shared/validation";

/** パラメーターの型検証前の通知を Host 内だけで受け渡す。 */
export type AppServerNotification = { method: string; params?: unknown };
/** 応答の ID と実行範囲を保持したサーバー発の要求。 */
export type AppServerRequest = {
	id: RequestId;
	method: string;
	params: unknown;
};
/** 通信方向を区別した、検証済みのメッセージ外形。 */
type RpcMessage =
	| { kind: "notification"; notification: AppServerNotification }
	| { kind: "request"; request: AppServerRequest }
	| {
			kind: "response";
			id: RequestId;
			result?: unknown;
			error?: AppServerRpcError;
	  };

/** エラー応答のコード・詳細を保持し、UI への表示は呼び出し側に任せる。 */
export class AppServerRpcError extends Error {
	/** サーバーのエラー情報を要求単位で保持する。 */
	constructor(
		public readonly code: number,
		message: string,
		public readonly data?: unknown,
	) {
		super(message);
	}
}
/** サーバー発行の文字列 ID と、クライアント発行の数値 ID を保持する。 */
function isRequestId(value: unknown): value is RequestId {
	return (
		typeof value === "string" ||
		(typeof value === "number" && Number.isSafeInteger(value))
	);
}
/** method を先に判定し、同じ ID のサーバー要求を応答と取り違えない。 */
export function parseRpcMessage(message: unknown): RpcMessage {
	if (!isRecord(message)) {
		throw new Error("Invalid envelope");
	}
	if ("method" in message) {
		return parseMethodMessage(message);
	}
	return parseResponse(message);
}

/** methodを持つサーバー要求と通知を検証する。 */
function parseMethodMessage(message: Record<string, unknown>): RpcMessage {
	if (
		typeof message.method !== "string" ||
		"result" in message ||
		"error" in message
	) {
		throw new Error("Invalid method");
	}
	if ("id" in message) {
		if (!isRequestId(message.id)) {
			throw new Error("Invalid request id");
		}
		return {
			kind: "request",
			request: {
				id: message.id,
				method: message.method,
				params: message.params,
			},
		};
	}
	return {
		kind: "notification",
		notification: { method: message.method, params: message.params },
	};
}

/** クライアント要求への応答とRPCエラーを検証する。 */
function parseResponse(message: Record<string, unknown>): RpcMessage {
	const hasResult = "result" in message;
	const hasError = "error" in message;
	if (!isRequestId(message.id) || hasResult === hasError) {
		throw new Error("Invalid response");
	}
	if (hasError) {
		if (
			!isRecord(message.error) ||
			!Number.isInteger(message.error.code) ||
			typeof message.error.code !== "number" ||
			typeof message.error.message !== "string"
		) {
			throw new Error("Invalid RPC error");
		}
		return {
			kind: "response",
			id: message.id,
			error: new AppServerRpcError(
				message.error.code,
				message.error.message,
				message.error.data,
			),
		};
	}
	return { kind: "response", id: message.id, result: message.result };
}
