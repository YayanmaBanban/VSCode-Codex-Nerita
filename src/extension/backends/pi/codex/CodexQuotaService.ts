// 非公開の Codex 利用枠 API を隔離し、失敗・認証情報をチャット状態へ漏らさない。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { QuotaWindow } from "../../../../shared/composer";
import { isRecord } from "../../../../shared/validation";
import { codexOAuth } from "./CodexOAuth";

/** 正規化された ISO 時間を取得する。 */
function getIsoDate(resetAt: number): Date {
	let data: Date = new Date(resetAt * 1000);
	data = new Date(data.getTime() - data.getTimezoneOffset() * 60 * 1000);
	return data;
}

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
			!isFiniteNumber(window.used_percent) ||
			typeof window.limit_window_seconds !== "number" ||
			!Number.isFinite(window.limit_window_seconds) ||
			window.limit_window_seconds <= 0
		) {
			continue;
		}
		const seconds = window.limit_window_seconds;
		const reset = quotaReset(window);
		windows.push({
			label: quotaWindowLabel(seconds),
			remaining: Math.max(0, Math.min(100, 100 - window.used_percent)),
			detail: quotaResetDetail(reset),
		});
	}
	return windows.length ? windows : null;
}

/** SDK による OAuth 更新を利用し、接続・設定変更・実行後だけ取得する。 */
export class CodexQuotaService {
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private request: typeof fetch = fetch,
	) {}

	/** 固定した HTTPS 宛先だけへ送信し、リダイレクトで認証が流出する経路を閉じる。 */
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
			if (this.modelChanged(model)) {
				return null;
			}
			return normalizeCodexQuota(payload);
		} catch {
			return null;
		}
	}

	/** 取得開始時と現在のモデルが一致するか照合する。 */
	private modelChanged(model: NonNullable<AgentSession["model"]>): boolean {
		return (
			this.session.model?.provider !== model.provider ||
			this.session.model?.id !== model.id
		);
	}
}

/** 有効なリセット時刻だけを表示用文字列へ整形する。 */
function quotaResetDetail(reset: Date | null): string {
	return reset && Number.isFinite(reset.getTime())
		? `リセット: ${reset.toISOString().replace("T", " ").slice(0, 19)}`
		: "";
}

/** 利用枠のリセット時刻を表示用へ変換する。 */
function quotaReset(window: Record<string, unknown>) {
	return typeof window.reset_at === "number"
		? getIsoDate(window.reset_at)
		: null;
}

/** 既知の利用枠には固定名を使い、その他は時間単位で表示する。 */
function quotaWindowLabel(seconds: number) {
	if (seconds === 18000) {
		return "5h";
	}
	if (seconds === 604800) {
		return "Weekly";
	}
	return `${Math.round(seconds / 3600)}h`;
}

/** 利用率に有限の数値だけを受け付ける。 */
function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
