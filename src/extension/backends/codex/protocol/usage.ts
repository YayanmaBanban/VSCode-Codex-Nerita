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
			!(
				window.windowDurationMins === null ||
				(typeof window.windowDurationMins === "number" &&
					window.windowDurationMins > 0)
			) ||
			!(
				window.resetsAt === null ||
				(typeof window.resetsAt === "number" &&
					Number.isFinite(window.resetsAt))
			)
		) {
			throw new Error("Invalid rate limit window");
		}
		const minutes = window.windowDurationMins;
		const label =
			minutes === null
				? key
				: minutes % 1440 === 0
					? `${minutes / 1440}日`
					: minutes % 60 === 0
						? `${minutes / 60}時間`
						: `${minutes}分`;
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
	return windows;
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
