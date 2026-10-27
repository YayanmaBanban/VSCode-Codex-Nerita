// 自動レビューの表示記録だけを保存し、実行許可や会話本文を履歴へ持ち込まない。
import { z } from "zod";

export const autoReviewRecordSchema = z.strictObject({
	id: z.string().min(1).max(100),
	time: z.number(),
	tool: z.string().max(300),
	status: z.enum([
		"reviewing",
		"approved",
		"denied",
		"manual",
		"unavailable",
		"timedOut",
		"cancelled",
	]),
	reason: z.string().max(2000),
	model: z.string().max(300),
	durationMs: z.number().nonnegative(),
	prefetched: z.boolean().optional(),
	source: z.enum(["model", "shared", "cache", "prefetch"]).optional(),
	reusedFrom: z.string().max(100).optional(),
	reviewDurationMs: z.number().nonnegative().optional(),
	metrics: z
		.strictObject({
			requests: z.number().int().nonnegative(),
			modelCalls: z.number().int().nonnegative(),
			shared: z.number().int().nonnegative(),
			hits: z.number().int().nonnegative(),
			prefetches: z.number().int().nonnegative(),
			unusedPrefetches: z.number().int().nonnegative(),
		})
		.optional(),
	risk: z.enum(["low", "medium", "high", "critical"]).optional(),
	authorization: z.enum(["unknown", "low", "medium", "high"]).optional(),
	action: z.strictObject({
		tool: z.string().max(300),
		cwd: z.string().max(4096),
		command: z.string().max(8192).optional(),
		path: z.string().max(4096).optional(),
	}),
});

/** Host が秘密値を除去した、履歴表示用の審査記録。復元しても許可として利用しない。 */
export type AutoReviewRecord = z.infer<typeof autoReviewRecordSchema>;
