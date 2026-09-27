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
export type TrustRequest = z.infer<typeof trustRequestSchema>;
export type TrustReply = z.infer<typeof trustReplySchema>;
export type TrustBridge = {
	postMessage(message: TrustRequest): void;
	subscribe(listener: (message: TrustReply) => void): () => void;
};
