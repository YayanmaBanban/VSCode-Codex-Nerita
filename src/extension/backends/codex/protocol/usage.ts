// 利用枠とコンテキストの通知を、アカウント情報を含まない表示値へ変換する。
import type { ContextUsage, QuotaWindow } from "../../../../shared/composer";
import { isRecord } from "../../../../shared/validation";

/** 利用枠の一つのバケットを検証する。 */
export function parseQuota(value: unknown): QuotaWindow[] {
	if (!isRecord(value)) {
		throw new Error("Invalid rate limits");
	}
	const windows: QuotaWindow[] = [];
	for (const key of ["primary", "secondary"] as const) {
		const window = value[key];
		if (window === null || window === undefined) {
			continue;
		}
		if (
			!isRecord(window) ||
			typeof window.usedPercent !== "number" ||
			!Number.isFinite(window.usedPercent) ||
			!isWindowDuration(window.windowDurationMins) ||
			!isResetTime(window.resetsAt)
		) {
			throw new Error("Invalid rate limit window");
		}
		appendQuotaWindow(
			{
				windowDurationMins: window.windowDurationMins,
				resetsAt: window.resetsAt,
				usedPercent: window.usedPercent,
			},
			key,
			windows,
		);
	}
	return windows;
}
/** 検証済みの利用枠を表示用の残量と期限へ変換する。 */
function appendQuotaWindow(
	window: {
		windowDurationMins: number | null;
		resetsAt: number | null;
		usedPercent: number;
	},
	key: string,
	windows: QuotaWindow[],
) {
	const minutes = window.windowDurationMins;
	const label = quotaWindowLabel(minutes, key);
	const reset =
		window.resetsAt === null ? null : new Date(window.resetsAt * 1000);
	windows.push({
		label,
		remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)),
		detail:
			reset && Number.isFinite(reset.getTime())
				? `${reset.toLocaleString("ja-JP")} にリセット`
				: "リセット時刻は未取得",
	});
}

/** 利用枠の期間は未指定または正の数を受け付ける。 */
function isWindowDuration(value: unknown): value is number | null {
	return value === null || (typeof value === "number" && value > 0);
}

/** リセット時刻は未指定または有限の数値を受け付ける。 */
function isResetTime(value: unknown): value is number | null {
	return (
		value === null || (typeof value === "number" && Number.isFinite(value))
	);
}

/** 読み取り応答の互換バケットを利用する。 */
export function parseQuotaResponse(value: unknown): QuotaWindow[] {
	if (!isRecord(value)) {
		throw new Error("Invalid rate limits response");
	}
	return parseQuota(value.rateLimits);
}
/** 累積課金トークンではなく、直近のコンテキスト使用量を表示する。 */
export function parseUsage(value: unknown): ContextUsage | null {
	if (
		!isRecord(value) ||
		!isRecord(value.last) ||
		typeof value.last.totalTokens !== "number" ||
		!Number.isFinite(value.last.totalTokens) ||
		value.last.totalTokens < 0
	) {
		throw new Error("Invalid token usage");
	}
	if (value.modelContextWindow === null) {
		return null;
	}
	if (
		typeof value.modelContextWindow !== "number" ||
		!Number.isFinite(value.modelContextWindow) ||
		value.modelContextWindow <= 0
	) {
		throw new Error("Invalid context window");
	}
	return { used: value.last.totalTokens, size: value.modelContextWindow };
}

/** 利用枠の期間を割り切れる最大の日・時間・分単位で表示する。 */
function quotaWindowLabel(minutes: number | null, key: string) {
	if (minutes === null) {
		return key;
	}
	if (minutes % 1440 === 0) {
		return `${minutes / 1440}日`;
	}
	if (minutes % 60 === 0) {
		return `${minutes / 60}時間`;
	}
	return `${minutes}分`;
}
