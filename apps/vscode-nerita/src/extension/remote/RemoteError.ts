// HTTP に返すエラーを固定コードと安全な文言に変換する。
import type { RemoteErrorCode } from "@nerita/shared/remote/contracts";

const messages = {
	invalid_request: [400, "操作の内容を確認してください。"],
	unauthenticated: [401, "PCでペアリングコードを表示して接続してください。"],
	forbidden: [403, "この操作はPCで確認してください。"],
	csrf_invalid: [403, "ページを開き直してから操作してください。"],
	stale_session: [409, "会話が変わりました。"],
	stale_run: [409, "対象の実行は終了しました。"],
	stale_approval: [409, "対象の承認はすでに処理されています。"],
	stale_backend: [409, "バックエンドが変わりました。"],
	backend_switch_busy: [
		409,
		"実行や接続の処理が終わってから操作してください。",
	],
	payload_too_large: [413, "送信できるサイズを超えました。"],
	too_many_requests: [
		429,
		"操作の回数が上限に達しました。少し待ってからお試しください。",
	],
	host_unavailable: [503, "PC側のNeritaを確認してください。"],
	backend_unavailable: [503, "バックエンドの状態をPCで確認してください。"],
} as const;

/** 端末へ安全に公開できる固定エラー。 */
export class RemoteError extends Error {
	readonly status: number;

	/** 内部例外の本文を公開せず、固定メッセージを選ぶ。 */
	constructor(readonly code: RemoteErrorCode) {
		const [status, message] = messages[code];
		super(message);
		this.status = status;
	}
}
