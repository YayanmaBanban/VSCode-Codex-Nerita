// 新しい OpenAI 認証だけを SDK で解決し、秘密値を Host 内に留める。
import { createHash } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";

/** トークンの更新は SDK に任せ、API キーを ChatGPT 用エンドポイントへ送信しない。 */
export async function openAIOAuth(models: ModelRuntime, signal: AbortSignal) {
	if (!models.isUsingOAuth("openai")) {
		return null;
	}
	const resolved = await models.getAuth("openai", { signal });
	signal.throwIfAborted();
	const check = await models.checkAuth("openai", { signal });
	signal.throwIfAborted();
	const token = resolved?.auth.apiKey;
	if (check?.type !== "oauth" || !token) {
		return null;
	}
	return {
		key: createHash("sha256").update(token).digest("hex"),
		token,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	};
}

/** 公開 API の既定宛先だけに拡張機能を適用する。 */
export function isOpenAIEndpoint(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		return (
			url.origin === "https://api.openai.com" &&
			url.pathname.replace(/\/$/, "") === "/v1" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}

/** JWT 形式の場合だけ任意のアカウント識別子を読む。存在しない値は推測しない。 */
export function openAIAccountId(token: string): string | undefined {
	try {
		const payload: unknown = JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString(
				"utf8",
			),
		);
		const claim = isRecord(payload)
			? payload["https://api.openai.com/auth"]
			: undefined;
		const id = isRecord(claim) ? claim.chatgpt_account_id : undefined;
		return typeof id === "string" && /^[\w-]{1,200}$/.test(id)
			? id
			: undefined;
	} catch {
		return undefined;
	}
}
