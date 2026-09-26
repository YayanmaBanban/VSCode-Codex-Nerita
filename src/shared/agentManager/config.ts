// 管理画面が保存する値だけを検証し、バックエンドの設定優先順位は扱わない。
import { z } from "zod";

export const backendSchema = z.enum(["pi", "codex"]);
export const modelSchema = z.string().trim().min(1).max(300);
export const piThinkingSchema = z.enum([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
export const codexReasoningSchema = z.enum([
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
]);

/** 管理・保存では、プロバイダー固有の Ultra も扱う。実行時の変換はバックエンド側の責務。 */
export const piEffortSchema = piThinkingSchema.or(z.literal("ultra"));

/** 未指定はバックエンド既定値へ戻す操作として扱う。 */
export const agentEditSchema = z.strictObject({
	model: modelSchema.optional(),
	thinking: piEffortSchema.optional(),
	reasoningEffort: codexReasoningSchema.optional(),
	disabled: z.boolean().optional(),
});
export type AgentEdit = z.infer<typeof agentEditSchema>;
export const piDefaultsSchema = z.strictObject({
	defaultModel: modelSchema.optional(),
	defaultThinking: piEffortSchema.optional(),
	maxThinking: piThinkingSchema.optional(),
	maxSubagentSpawnsPerSession: z.number().int().min(0).max(100000).optional(),
});
export type PiDefaults = z.infer<typeof piDefaultsSchema>;

/** current に固定モデルが残らないよう、保存形式を別々に検証する。 */
const piHandoffSchema = z.discriminatedUnion("strategy", [
	z.strictObject({
		strategy: z.literal("fixed"),
		model: modelSchema,
		thinking: piEffortSchema.optional(),
	}),
	z.strictObject({
		strategy: z.literal("current"),
		thinking: piEffortSchema.optional(),
	}),
]);
const codexHandoffSchema = z.discriminatedUnion("strategy", [
	z.strictObject({
		strategy: z.literal("fixed"),
		model: modelSchema,
		reasoningEffort: codexReasoningSchema.optional(),
	}),
	z.strictObject({
		strategy: z.literal("current"),
		reasoningEffort: codexReasoningSchema.optional(),
	}),
]);
export const handoffSchema = z.strictObject({
	version: z.literal(1),
	defaults: z.strictObject({
		timeoutMs: z.number().int().positive().max(2147483647),
	}),
	backends: z.strictObject({
		pi: piHandoffSchema,
		codex: codexHandoffSchema,
	}),
});
export type HandoffConfig = z.infer<typeof handoffSchema>;

/** ファイルがない場合だけ表示する初期値。閲覧ではファイルを作らない。 */
export function defaultHandoff(): HandoffConfig {
	return {
		version: 1,
		defaults: { timeoutMs: 120000 },
		backends: {
			pi: { strategy: "current" },
			codex: { strategy: "current" },
		},
	};
}
