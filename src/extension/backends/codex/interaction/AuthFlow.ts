// ブラウザ認証の通知と応答の順序を吸収し、秘密情報をUIへ渡さない。
import type { CodexClient } from "../CodexClient";
import type { AppServerNotification } from "../protocol/rpcMessage";
import { isRecord } from "../../../../shared/validation";

/** VS Code のブラウザ起動と環境変数取得を差し替える境界。 */
export type AuthService = {
	open: (url: string) => Promise<void>;
	apiKey: () => string | undefined;
};
/** 一つの接続のログインだけを待機する。 */
export class AuthFlow {
	private complete: ((id: string, success: boolean) => void) | undefined;
	/** login/completed以外の通知は通常の状態管理へ渡す。 */
	notification(message: AppServerNotification): boolean {
		if (message.method !== "account/login/completed") {
			return false;
		}
		if (
			isRecord(message.params) &&
			typeof message.params.loginId === "string" &&
			typeof message.params.success === "boolean"
		) {
			this.complete?.(message.params.loginId, message.params.success);
		}
		return true;
	}
	/** ログイン受付より早い完了も保存し、切断時には待機を解消する。 */
	async start(
		client: Pick<CodexClient, "login" | "cancelLogin">,
		method: string,
		service: AuthService,
		signal: AbortSignal,
	): Promise<void> {
		signal.throwIfAborted();
		if (method === "apiKey") {
			const apiKey = service.apiKey();
			if (!apiKey) {
				throw new Error("API key unavailable");
			}
			await client.login({ type: "apiKey", apiKey });
			return;
		}
		if (method !== "chatgpt") {
			throw new Error("Unknown login method");
		}
		let loginId: string | undefined;
		const early = new Map<string, boolean>();
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const done = new Promise<void>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		// URLを開く前に失敗・取消が起きても未処理の拒否にしない。
		void done.catch(() => undefined);
		this.complete = (id, success) => {
			if (!loginId) {
				if (early.size < 16) {
					early.set(id, success);
				}
				return;
			}
			if (id === loginId) {
				if (success) {
					resolve();
				} else {
					reject(new Error("Login failed"));
				}
			}
		};
		const abort = () => {
			if (loginId) {
				void client.cancelLogin(loginId).catch(() => undefined);
			}
			reject(new Error("Login cancelled"));
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			const result = await client.login({ type: "chatgpt" });
			if (result.type !== "chatgpt") {
				throw new Error("Unexpected login method");
			}
			loginId = result.loginId;
			signal.throwIfAborted();
			const url = new URL(result.authUrl);
			if (
				url.protocol !== "https:" ||
				url.hostname !== "auth.openai.com"
			) {
				throw new Error("Invalid authentication URL");
			}
			await service.open(url.href);
			if (early.has(loginId)) {
				this.complete(loginId, early.get(loginId)!);
			}
			await done;
		} finally {
			this.complete = undefined;
			signal.removeEventListener("abort", abort);
		}
	}
}
