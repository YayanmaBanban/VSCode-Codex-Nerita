// 非公開のCodex利用枠APIを隔離し、失敗・認証情報をチャット状態へ漏らさない。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { QuotaWindow } from "../../../../shared/composer";
import { isRecord } from "../../../../shared/validation";
import { codexOAuth } from "./CodexOAuth";

/** 未知の応答項目は捨て、検証できる時間枠と残率だけ公開する。 */
export function normalizeCodexQuota(payload: unknown): QuotaWindow[] | null {
	if (!isRecord(payload) || !isRecord(payload.rate_limit)) {
		return null;
	}
	const windows: QuotaWindow[] = [];
	for (const key of ["primary_window", "secondary_window"]) {
		const window = payload.rate_limit[key];
		if (
			!isRecord(window) ||
			typeof window.used_percent !== "number" ||
			!Number.isFinite(window.used_percent) ||
			typeof window.limit_window_seconds !== "number" ||
			!Number.isFinite(window.limit_window_seconds) ||
			window.limit_window_seconds <= 0
		) {
			continue;
		}
		const seconds = window.limit_window_seconds;
		const reset =
			typeof window.reset_at === "number"
				? new Date(window.reset_at * 1000)
				: null;
		windows.push({
			label:
				seconds === 18000
					? "5h"
					: seconds === 604800
						? "Weekly"
						: `${Math.round(seconds / 3600)}h`,
			remaining: Math.max(0, Math.min(100, 100 - window.used_percent)),
			detail:
				reset && Number.isFinite(reset.getTime())
					? `リセット: ${reset.toISOString()}`
					: "",
		});
	}
	return windows.length ? windows : null;
}

/** SDKによるOAuth更新を利用し、接続・設定変更・実行後だけ取得する。 */
export class CodexQuotaService {
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private request: typeof fetch = fetch,
	) {}

	/** 固定したHTTPS宛先だけへ送信し、redirectで認証が流出する経路を閉じる。 */
	async read(caller: AbortSignal): Promise<QuotaWindow[] | null> {
		try {
			const model = this.session.model;
			if (
				model?.provider !== "openai-codex" ||
				model.api !== "openai-codex-responses" ||
				!this.models.isUsingOAuth(model.provider)
			) {
				return null;
			}
			const signal = AbortSignal.any([
				caller,
				AbortSignal.timeout(10_000),
			]);
			const auth = await codexOAuth(this.models, signal);
			signal.throwIfAborted();
			if (!auth) {
				return null;
			}
			const response = await this.request(
				"https://chatgpt.com/backend-api/wham/usage",
				{
					signal,
					redirect: "error",
					headers: auth.headers,
				},
			);
			if (!response.ok) {
				return null;
			}
			const payload: unknown = await response.json();
			signal.throwIfAborted();
			if (
				this.session.model?.provider !== model.provider ||
				this.session.model?.id !== model.id
			) {
				return null;
			}
			return normalizeCodexQuota(payload);
		} catch {
			return null;
		}
	}
}
