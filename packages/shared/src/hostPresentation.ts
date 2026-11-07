// 実行環境に依存する案内と保存先の表示名は Host が決定し、UI は検証済みの値だけを描画する。
import { z } from "zod";

const authenticationSchema = z.strictObject({
	required: z.string(),
	pending: z.string(),
});
export const hostPresentationSchema = z.strictObject({
	credentialStorageLabels: z.strictObject({
		session: z.string(),
		"secret-storage": z.string(),
	}),
	autoReviewStorageDescription: z.string(),
	guardrailsRepairDescription: z.string(),
	trust: z.strictObject({
		codexStorageDescription: z.string(),
		piStorageDescription: z.string(),
		piStorageKey: z.string(),
	}),
	authentication: z.strictObject({
		codex: authenticationSchema,
		pi: authenticationSchema,
	}),
});
/** 秘密値・実行コード・HTML を含まない、画面起動時の表示情報。 */
export type HostPresentation = z.infer<typeof hostPresentationSchema>;
export const hostPresentationRequestSchema = z.strictObject({
	type: z.literal("host/presentation"),
});
export const hostPresentationReplySchema = z.strictObject({
	type: z.literal("host/presentation"),
	presentation: hostPresentationSchema,
});
