// Trust 管理画面と Host の間で操作と表示データを検証する。
import { z } from "zod";

export const trustRequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("refresh"),
		requestId: z.string().optional(),
		backend: z.enum(["codex", "pi"]).optional(),
	}),
	z.object({
		type: z.literal("add"),
		requestId: z.string().optional(),
		backend: z.enum(["codex", "pi"]).optional(),
	}),
	z.object({
		type: z.enum(["trust", "revoke", "remove"]),
		requestId: z.string().optional(),
		confirmationId: z.string().optional(),
		root: z.string().min(1),
		backend: z.enum(["codex", "pi"]).optional(),
	}),
]);
/** Host が確認した実体と、1回だけ確定できる信頼操作。 */
export const trustConfirmationSchema = z.object({
	id: z.string(),
	root: z.string(),
	canonical: z.string(),
	external: z.boolean(),
	backend: z.enum(["codex", "pi"]),
});
export const trustReplySchema = z.object({
	type: z.literal("state"),
	requestId: z.string().optional(),
	revision: z.number().optional(),
	confirmation: trustConfirmationSchema.nullish(),
	backend: z.enum(["codex", "pi"]).optional(),
	piStoragePath: z.string().optional(),
	records: z.array(
		z.object({
			root: z.string(),
			trust: z.enum(["trusted", "untrusted", "unset"]),
			origin: z.enum(["workspace", "external", "external-cache"]),
			updatedAt: z.number().nullable(),
		}),
	),
	error: z.string().nullable(),
});
/** 信頼記録の操作要求。外部入力は `trustRequestSchema` で検証してから扱う。 */
export type TrustRequest = z.infer<typeof trustRequestSchema>;
/** 信頼記録の状態応答。外部入力は `trustReplySchema` で検証してから扱う。 */
export type TrustReply = z.infer<typeof trustReplySchema>;
/** 確認画面は Host の値だけを表示し、確定時は id をそのまま返す。 */
export type TrustConfirmation = z.infer<typeof trustConfirmationSchema>;
/** 信頼記録の通信境界。利用側は `subscribe` が返す解除関数を破棄時に呼び出す。 */
export type TrustBridge = {
	postMessage(message: TrustRequest): void;
	subscribe(listener: (message: TrustReply) => void): () => void;
};
