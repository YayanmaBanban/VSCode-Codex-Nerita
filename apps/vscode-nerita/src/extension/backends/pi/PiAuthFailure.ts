// 認証失敗から確認できた分類だけを残し、秘密値を含みうる SDK の本文と cause は UI へ渡さない。
import { isRecord } from "@nerita/shared/validation";

/** 認証の無効化を断定できる応答と、再認証・権限・通信の問題を区別する。 */
export type PiAuthFailureKind =
	"revoked" | "reauthenticate" | "forbidden" | "network" | "unavailable";

const messages: Record<PiAuthFailureKind, string> = {
	revoked: "この認証は無効化されています。OAuthでログインし直してください。",
	reauthenticate:
		"この認証は現在使用できません。OAuthでログインし直してください。",
	forbidden:
		"この認証にはアクセス権限がありません。アカウントの権限を確認してください。",
	network:
		"認証サービスとの通信に失敗し、認証状態を確認できませんでした。再試行してください。",
	unavailable:
		"認証状態を確認できませんでした。時間をおいて再試行してください。",
};

/** エラー本文や生の応答を保持せず、安全な分類と案内だけを通知する。 */
export class PiAuthFailure extends Error {
	/** 秘密値を含みうる元の例外は保持せず、分類に対応する案内を設定する。 */
	constructor(readonly kind: PiAuthFailureKind) {
		super(messages[kind]);
		this.name = "PiAuthFailure";
	}
}

/** HTTP 拒否だけで無効化を断定せず、サーバーが返した既知のコードを優先する。 */
export function piAuthResponseFailure(
	status: number,
	payload: unknown,
): PiAuthFailure {
	const code = responseCode(payload);
	const revoked = [
		"token_revoked",
		"token_invalidated",
		"refresh_token_revoked",
	].includes(code ?? "");
	if (revoked) {
		return new PiAuthFailure("revoked");
	}
	const reauthenticate = [
		"invalid_grant",
		"invalid_client",
		"unauthorized_client",
		"invalid_token",
		"invalid_api_key",
		"refresh_token_expired",
		"refresh_token_reused",
	].includes(code ?? "");
	if (reauthenticate) {
		return new PiAuthFailure("reauthenticate");
	}
	if (status === 401) {
		return new PiAuthFailure("reauthenticate");
	}
	return new PiAuthFailure(status === 403 ? "forbidden" : "unavailable");
}

/** SDK の既知の更新エラー形式だけを解析し、任意の本文を画面へ表示しない。 */
export function piAuthFailure(error: unknown): PiAuthFailure {
	let current = error;
	for (let depth = 0; depth < 6; depth++) {
		if (current instanceof PiAuthFailure) {
			return current;
		}
		if (!(current instanceof Error)) {
			break;
		}
		const tokenFailure = sdkTokenFailure(current.message);
		if (tokenFailure) {
			return tokenFailure;
		}
		if (isNetworkError(current)) {
			return new PiAuthFailure("network");
		}
		current = current.cause;
	}
	return new PiAuthFailure("unavailable");
}

/** `error` の文字列か `code` だけを参照し、説明文やリクエストの内容は使わない。 */
function responseCode(payload: unknown): string | undefined {
	if (!isRecord(payload)) {
		return undefined;
	}
	if (typeof payload.error === "string") {
		return payload.error;
	}
	const error = isRecord(payload.error) ? payload.error : payload;
	return typeof error.code === "string" ? error.code : undefined;
}

/** 同梱 OpenAI SDK は更新 API のステータスと JSON を Error.message に包む。 */
function sdkTokenFailure(message: string) {
	const match =
		/^OpenAI OAuth token request failed \((\d{3})\): ([\s\S]*)$/.exec(
			message,
		);
	if (!match) {
		return undefined;
	}
	let payload: unknown;
	try {
		payload = JSON.parse(match[2]!.slice(0, 65536));
	} catch {
		payload = undefined;
	}
	return piAuthResponseFailure(Number(match[1]), payload);
}

/** 名前解決の失敗・接続エラー・通信のタイムアウトを、認証の失効として扱わない。 */
function isNetworkError(error: Error) {
	const timeout = error.name === "TimeoutError";
	const fetchFailed =
		error instanceof TypeError && error.message === "fetch failed";
	const code = "code" in error ? error.code : undefined;
	return (
		timeout ||
		fetchFailed ||
		[
			"ENOTFOUND",
			"EAI_AGAIN",
			"ECONNRESET",
			"ECONNREFUSED",
			"ETIMEDOUT",
		].includes(typeof code === "string" ? code : "")
	);
}
