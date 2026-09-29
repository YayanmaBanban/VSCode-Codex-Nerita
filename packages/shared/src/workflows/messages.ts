// 専用エディタの文書更新と実行要求を、文書の版と要求番号で照合する。
import { z } from "zod";

export const workflowFileSchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.toml$/);
export const workflowRequestSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("ready") }),
	z.strictObject({
		type: z.literal("edit"),
		id: z.number().int(),
		version: z.number().int(),
		text: z.string().max(262144),
	}),
	z.strictObject({
		type: z.enum(["save", "check", "run"]),
		id: z.number().int(),
		version: z.number().int(),
	}),
	z.strictObject({ type: z.literal("stop") }),
	z.strictObject({ type: z.literal("chat") }),
]);
export const workflowStateSchema = z.strictObject({
	type: z.literal("state"),
	text: z.string(),
	version: z.number().int(),
	dirty: z.boolean(),
	file: z.string(),
	running: z.boolean(),
});
export const workflowReplySchema = z.union([
	workflowStateSchema,
	z.strictObject({
		type: z.literal("reply"),
		id: z.number().int(),
		error: z.string().nullable(),
		notice: z.string(),
		script: z.string().optional(),
	}),
]);
export type WorkflowRequest = z.infer<typeof workflowRequestSchema>;
export type WorkflowReply = z.infer<typeof workflowReplySchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowBridge = {
	postMessage: (message: WorkflowRequest) => void;
	subscribe: (listener: (message: WorkflowReply) => void) => () => void;
};
/** 実行先のルートは Webview に指定させず、開いている文書から Host が決める。 */
export type WorkflowExecution = { root: string; file: string; text: string };
