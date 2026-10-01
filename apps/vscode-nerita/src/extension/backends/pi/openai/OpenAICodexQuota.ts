// 会話の OAuth とは別に、既存 Codex ログインの利用枠を読取り専用で取得する。
import { CodexClient } from "../../codex/CodexClient";
import type { PiQuotaReader } from "../PiProvider";

/** 認証値を取り出さず、同梱 CLI の検証済み RPC とプロセス寿命を利用する。 */
export function openAICodexQuota(
	extensionPath: string,
	cwd: string,
	lifetime: AbortSignal,
): PiQuotaReader {
	return {
		async read(caller) {
			const signal = AbortSignal.any([
				caller,
				lifetime,
				AbortSignal.timeout(10_000),
			]);
			let client: CodexClient | undefined;
			try {
				signal.throwIfAborted();
				client = await CodexClient.connect({
					extensionPath,
					cwd,
					signal,
					clientInfo: {
						name: "nerita_quota",
						title: "Nerita quota",
						version: "0.0.1",
					},
				});
				const account = await client.readAccount();
				if (!account.authenticated) {
					return null;
				}
				const windows = await client.readRateLimits();
				signal.throwIfAborted();
				return windows.length
					? windows.map((window) => ({
							...window,
							source: "codex-login" as const,
						}))
					: null;
			} catch {
				return null;
			} finally {
				await client?.dispose();
			}
		},
	};
}
