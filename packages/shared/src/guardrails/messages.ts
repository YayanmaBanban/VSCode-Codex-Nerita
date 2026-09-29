// 専用エディターの通信は文書バージョンと要求 ID を照合して処理する。
import { z } from "zod";
import { guardActionSchema } from "./config";

export const guardProbeSchema = z.strictObject({
	tool: z.enum([
		"read",
		"ls",
		"write",
		"edit",
		"powershell",
		"pwsh",
		"bash",
		"extension",
	]),
	input: z.string().max(32768),
	cwd: z.string().max(4096),
});
export type GuardProbe = z.infer<typeof guardProbeSchema>;
export const guardResultSchema = z.strictObject({
	action: guardActionSchema,
	reasons: z.array(z.string()),
	rules: z.array(z.string()),
	paths: z.array(z.string()),
	uncertainties: z.array(z.string()),
});
export type GuardResult = z.infer<typeof guardResultSchema>;
export const guardRequestSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("ready") }),
	z.strictObject({
		type: z.literal("edit"),
		id: z.number().int(),
		version: z.number().int(),
		text: z.string().max(131072),
	}),
	z.strictObject({
		type: z.literal("save"),
		id: z.number().int(),
		version: z.number().int(),
	}),
	z.strictObject({
		type: z.literal("apply"),
		id: z.number().int(),
		version: z.number().int(),
	}),
	z.strictObject({
		type: z.literal("check"),
		id: z.number().int(),
		version: z.number().int(),
		probe: guardProbeSchema,
	}),
]);
export type GuardRequest = z.infer<typeof guardRequestSchema>;
export const guardStateSchema = z.strictObject({
	type: z.literal("state"),
	text: z.string(),
	version: z.number().int(),
	dirty: z.boolean(),
	root: z.string(),
	activeText: z.string(),
});
export const guardReplySchema = z.union([
	guardStateSchema,
	z.strictObject({
		type: z.literal("reply"),
		id: z.number().int(),
		error: z.string().nullable(),
		notice: z.string(),
		result: guardResultSchema.nullable(),
		warnings: z.array(z.string()),
	}),
]);
export type GuardReply = z.infer<typeof guardReplySchema>;
export type GuardState = z.infer<typeof guardStateSchema>;
export type GuardBridge = {
	postMessage: (message: GuardRequest) => void;
	subscribe: (listener: (message: GuardReply) => void) => () => void;
};
