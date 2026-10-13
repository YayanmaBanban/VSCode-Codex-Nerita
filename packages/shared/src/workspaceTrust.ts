// Trust 管理画面と Host の間で操作と表示データを検証する。
import { z } from "zod";

export const trustRequestSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("refresh") }),
	z.object({ type: z.literal("add") }),
	z.object({
		type: z.enum(["trust", "revoke", "remove"]),
		root: z.string().min(1),
	}),
]);
export const trustReplySchema = z.object({
	type: z.literal("state"),
	records: z.array(
		z.object({
			root: z.string(),
			trust: z.enum(["trusted", "untrusted"]),
			origin: z.enum(["workspace", "external", "external-cache"]),
			updatedAt: z.number(),
		}),
	),
	error: z.string().nullable(),
});
/** 信頼記録の操作要求。外部入力は `trustRequestSchema` で検証してから扱う。 */
export type TrustRequest = z.infer<typeof trustRequestSchema>;
/** 信頼記録の状態応答。外部入力は `trustReplySchema` で検証してから扱う。 */
export type TrustReply = z.infer<typeof trustReplySchema>;
/** 信頼記録の通信境界。利用側は `subscribe` が返す解除関数を破棄時に呼び出す。 */
export type TrustBridge = {
	postMessage(message: TrustRequest): void;
	subscribe(listener: (message: TrustReply) => void): () => void;
};
