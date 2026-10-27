// 自動レビューの信頼済み設定を、管理画面と Host で共有する。
import { z } from "zod";
import { piThinkingSchema } from "./config";

export const autoReviewConfigSchema = z.strictObject({
	mode: z.enum(["manual", "auto"]),
	model: z.string().max(300),
	thinking: piThinkingSchema,
	timeoutMs: z.number().int().min(1000).max(120000),
	instructions: z.string().max(8000),
});
/** 設定は Host の保存領域で管理し、プロジェクトの JSON から有効化しない。 */
export type AutoReviewConfig = z.infer<typeof autoReviewConfigSchema>;

/** 外部送信や通常操作の自動実行は、利用者が有効化するまで開始しない。 */
export function defaultAutoReview(): AutoReviewConfig {
	return {
		mode: "manual",
		model: "",
		thinking: "low",
		timeoutMs: 30000,
		instructions: "",
	};
}
