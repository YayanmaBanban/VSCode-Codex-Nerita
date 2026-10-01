// 新しい ChatGPT OAuth の取得を試し、アクセス拒否時は出所を明示する Codex 取得へ委譲する。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { QuotaWindow } from "@nerita/shared/composer";
import { isRecord } from "@nerita/shared/validation";
import { openAIOAuth, openAIAccountId, isOpenAIEndpoint } from "./OpenAIOAuth";
import { readOpenAIResponse } from "./OpenAIResponseBody";
import type { PiQuotaReader } from "../PiProvider";

/** UNIX 秒を、現地時刻の表示に使う `Date` へ変換する。 */
function getIsoDate(resetAt: number): Date {
	let data: Date = new Date(resetAt * 1000);
	data = new Date(data.getTime() - data.getTimezoneOffset() * 60 * 1000);
	return data;
}

/** 未知の応答項目は捨て、検証できる時間枠と残率だけ公開する。 */
export function normalizeOpenAIQuota(payload: unknown): QuotaWindow[] | null {
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
export class OpenAIQuotaService {
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private request: typeof fetch = fetch,
		private codexQuota?: PiQuotaReader,
	) {}

	/** 固定した HTTPS 宛先だけへ送信し、リダイレクトで認証が流出する経路を閉じる。 */
	async read(caller: AbortSignal): Promise<QuotaWindow[] | null> {
		try {
			const model = this.session.model;
			if (!model || !this.canFetch(model)) {
				return null;
			}
			const startedModel = { ...model };
			const signal = AbortSignal.any([
				caller,
				AbortSignal.timeout(10_000),
			]);
			const auth = await openAIOAuth(this.models, signal);
			signal.throwIfAborted();
			if (!auth) {
				return null;
			}
			const account = openAIAccountId(auth.token);
			const response = await this.request(
				"https://chatgpt.com/backend-api/wham/usage",
				{
					signal,
					redirect: "error",
					headers: {
						...auth.headers,
						...(account ? { "ChatGPT-Account-Id": account } : {}),
					},
				},
			);
			if (!response.ok) {
				return await this.deniedQuota(response, startedModel, signal);
			}
			const payload: unknown = await readOpenAIResponse(response, signal);
			signal.throwIfAborted();
			if (this.modelChanged(startedModel)) {
				return null;
			}
			return normalizeOpenAIQuota(payload);
		} catch {
			return null;
		}
	}

	/** 新認証の利用枠アクセスが拒否された場合だけ、出所を明示する CLI 取得へ委譲する。 */
	private async deniedQuota(
		response: Response,
		model: NonNullable<AgentSession["model"]>,
		signal: AbortSignal,
	) {
		await response.body?.cancel();
		if (response.status !== 401 && response.status !== 403) {
			return null;
		}
		const quota = await this.codexQuota?.read(signal);
		signal.throwIfAborted();
		return this.modelChanged(model) ? null : (quota ?? null);
	}

	/** API キーや独自宛先のモデルから利用枠の認証を流用しない。 */
	private canFetch(model: NonNullable<AgentSession["model"]>): boolean {
		return (
			model.provider === "openai" &&
			model.api === "openai-responses" &&
			isOpenAIEndpoint(model.baseUrl) &&
			this.models.isUsingOAuth(model.provider)
		);
	}

	/** 取得開始時と現在のモデルが一致するか照合する。 */
	private modelChanged(model: NonNullable<AgentSession["model"]>): boolean {
		const current = this.session.model;
		if (!current || !this.canFetch(current)) {
			return true;
		}
		return (
			current.provider !== model.provider ||
			current.id !== model.id ||
			current.api !== model.api ||
			current.baseUrl !== model.baseUrl
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
