// DLC の操作と表示を定義し、UI から実行結果や状態を直接書き込ませない。
import { z } from "zod";

export const DlcPathSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine(
		(value) =>
			!value.includes("\\") &&
			!value.startsWith("/") &&
			!value.includes(":") &&
			value
				.split("/")
				.every((part) => part !== ".." && part !== "." && part !== ""),
		"ワークスペース内の相対パスを指定してください。",
	);
export const DlcTaskSchema = z.strictObject({
	title: z.string().trim().min(1).max(256),
	instructions: z.string().trim().min(1).max(16000),
	paths: z.array(DlcPathSchema).min(1).max(100),
});
export const DlcActionSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("plan"),
		tasks: z.array(DlcTaskSchema).min(1).max(50),
	}),
	z.strictObject({ type: z.literal("run") }),
	z.strictObject({ type: z.literal("cancel") }),
	z.strictObject({ type: z.literal("retry"), workItemId: z.string().min(1) }),
]);
export type DlcAction = z.infer<typeof DlcActionSchema>;
export type DlcTask = z.infer<typeof DlcTaskSchema>;

export const DlcWorkStatusSchema = z.enum([
	"ready",
	"running",
	"stopping",
	"implemented",
	"failed",
	"cancelled",
	"interrupted",
]);
export const DlcProjectionSchema = z.strictObject({
	projectId: z.string(),
	goal: z.string(),
	revision: z.number().int().nonnegative(),
	stage: z.enum(["planning", "implementing", "awaiting-review"]),
	workItems: z.array(
		z.strictObject({
			id: z.string(),
			title: z.string(),
			status: DlcWorkStatusSchema,
			attemptCount: z.number().int().nonnegative(),
			detail: z.string().nullable(),
		}),
	),
	canRun: z.boolean(),
	canCancel: z.boolean(),
});
export type DlcProjection = z.infer<typeof DlcProjectionSchema>;
