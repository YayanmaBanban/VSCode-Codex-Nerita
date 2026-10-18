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

/** Pi の管理画面とハンドオフ設定には、SDK の通常推論レベルだけを保存する。 */
export const piEffortSchema = piThinkingSchema;

/** 名前は定義内の識別子で、ファイル名とは独立して変更できる。 */
export const agentIdentitySchema = z.strictObject({
	name: z.string().trim().min(1).max(80),
	description: z.string().max(2000),
	prompt: z.string().max(60000),
});

/** 未指定はバックエンド既定値へ戻す操作として扱う。 */
export const agentEditSchema = z.strictObject({
	definition: agentIdentitySchema.optional(),
	model: modelSchema.optional(),
	thinking: piEffortSchema.optional(),
	reasoningEffort: codexReasoningSchema.optional(),
	disabled: z.boolean().optional(),
});
/** 保存前に編集するエージェント定義。外部入力は `agentEditSchema` で検証してから扱う。 */
export type AgentEdit = z.infer<typeof agentEditSchema>;
export const piDefaultsSchema = z.strictObject({
	defaultModel: modelSchema.optional(),
	defaultThinking: piEffortSchema.optional(),
	maxThinking: piThinkingSchema.optional(),
	maxSubagentSpawnsPerSession: z.number().int().min(0).max(100000).optional(),
});
/** Pi のワークスペース既定設定。外部入力は `piDefaultsSchema` で検証してから扱う。 */
export type PiDefaults = z.infer<typeof piDefaultsSchema>;

/** 管理画面と実行アダプターで同じ保存形式を読み、未知の拡張設定は保存側で保持する。 */
export const piSubagentSettingsSchema = z.object({
	...piDefaultsSchema.shape,
	agentOverrides: z
		.record(
			z.string(),
			z.object({
				model: agentEditSchema.shape.model,
				thinking: agentEditSchema.shape.thinking,
				disabled: agentEditSchema.shape.disabled,
			}),
		)
		.optional(),
	modelScope: z.unknown().optional(),
});

/** `current` に固定モデルが残らないよう、保存形式を別々に検証する。 */
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
		timeoutMs: z.number().int().min(1000).max(600000).multipleOf(1000),
	}),
	backends: z.strictObject({
		pi: piHandoffSchema,
		codex: codexHandoffSchema,
	}),
});
/** 引き継ぎ先のバックエンドとモデルの設定。外部入力は `handoffSchema` で検証してから扱う。 */
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
