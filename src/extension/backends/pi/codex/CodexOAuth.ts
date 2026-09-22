// CodexのOAuth claimをHost内だけで読み、認証ヘッダーを共通化する。
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../../../shared/validation";

/** tokenの更新・保存はSDKへ委譲し、認証ファイルは直接読まない。 */
export async function codexOAuth(models: ModelRuntime, signal: AbortSignal) {
	if (!models.isUsingOAuth("openai-codex")) {
		return null;
	}
	const resolved = await models.getAuth("openai-codex", { signal });
	signal.throwIfAborted();
	if (
		(await models.checkAuth("openai-codex", { signal }))?.type !== "oauth"
	) {
		return null;
	}
	const token = resolved?.auth.apiKey;
	if (!token) {
		return null;
	}
	const claims: unknown = JSON.parse(
		Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
	);
	const auth = isRecord(claims)
		? claims["https://api.openai.com/auth"]
		: null;
	const account = isRecord(auth) ? auth.chatgpt_account_id : null;
	if (typeof account !== "string" || !account) {
		return null;
	}
	return {
		account,
		headers: {
			Authorization: `Bearer ${token}`,
			"ChatGPT-Account-Id": account,
			Accept: "application/json",
		},
	};
}
