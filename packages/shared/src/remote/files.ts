// 接続中の作業ツリーを操作するための公開契約。
import { z } from "zod";

/** Git から受け取ったリポジトリ相対パスだけを許す。 */
export function isRemoteFilePath(path: string): boolean {
	if (path === "" || path.length > 1024) {
		return false;
	}
	const reserved = path.includes("\\") || path.includes(":");
	const control = [...path].some((character) => character.charCodeAt(0) < 32);
	if (reserved || control) {
		return false;
	}
	return path
		.split("/")
		.every(
			(segment) =>
				!["", ".", "..", ".git"].includes(segment.toLowerCase()),
		);
}

const path = z.string().refine(isRemoteFilePath);
const head = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const index = z.string().regex(/^[0-9a-f]{64}$/u);
const destination = z.string().min(1).max(512);
const operation = {
	requestId: z.uuid(),
	backendGeneration: z.int().nonnegative(),
	sessionId: z.string().min(1).max(256),
};

export const remoteFilesRequestSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("list"), ...operation }),
	z.strictObject({ type: z.literal("read"), path, ...operation }),
	z.strictObject({ type: z.literal("stage"), path, ...operation }),
	z.strictObject({
		type: z.literal("commit"),
		index,
		message: z.string().trim().min(1).max(240),
		...operation,
	}),
	z.strictObject({
		type: z.literal("push"),
		head,
		destination,
		...operation,
	}),
]);

export const remoteFilesReplySchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("list"),
		files: z
			.array(
				z.strictObject({
					path,
					status: z.string().length(2),
					canStage: z.boolean(),
				}),
			)
			.max(200),
		index: index.nullable(),
		push: z.strictObject({ head, destination }).nullable(),
	}),
	z.strictObject({
		type: z.literal("file"),
		path,
		text: z.string().max(128 * 1024),
	}),
	z.strictObject({ type: z.literal("done") }),
]);

/** 接続中の作業ツリーに要求できる操作。 */
export type RemoteFilesRequest = z.infer<typeof remoteFilesRequestSchema>;

/** 絶対パスを含まない一覧・プレビュー・操作結果。 */
export type RemoteFilesReply = z.infer<typeof remoteFilesReplySchema>;
