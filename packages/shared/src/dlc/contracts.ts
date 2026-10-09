// DLC の操作と表示を定義し、UI から実行結果や状態を直接書き込ませない。
import { z } from "zod";

export const DlcPathSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine(
		(value) =>
			![...value].some((character) => character.charCodeAt(0) < 32) &&
			!/[<>"|?*]/u.test(value) &&
			!value.includes("\\") &&
			!value.startsWith("/") &&
			!value.includes(":") &&
			value
				.split("/")
				.every(
					(part) =>
						part !== ".." &&
						part !== "." &&
						part !== "" &&
						!/[. ]$/u.test(part) &&
						!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(
							part,
						),
				),
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
	z.strictObject({ type: z.literal("advance") }),
	z.strictObject({ type: z.literal("archive") }),
	z.strictObject({ type: z.literal("retry"), workItemId: z.string().min(1) }),
]);
export type DlcAction = z.infer<typeof DlcActionSchema>;
export type DlcTask = z.infer<typeof DlcTaskSchema>;

/** 選択は LLM に推定させず、未指定の場合は classic を使う。 */
export const ExecutionProfileSchema = z.enum([
	"enterprise",
	"feature",
	"mvp",
	"poc",
	"bugfix",
	"refactor",
	"infra",
	"security-patch",
	"classic",
	"workshop",
	"express",
]);
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
export const DlcProjectTypeSchema = z.enum([
	"greenfield",
	"brownfield",
	"unknown",
]);
export type DlcProjectType = z.infer<typeof DlcProjectTypeSchema>;

/** 状態と適用の判断を別に表示し、未確定をスキップと混同しない。 */
export const StageProjectionSchema = z.strictObject({
	id: z.string().regex(/^[0-4]\.[1-9]$/),
	selection: z.enum(["execute", "skip", "undetermined"]),
	status: z.enum([
		"pending",
		"active",
		"awaiting-approval",
		"revising",
		"completed",
		"skipped",
	]),
	reason: z.string().min(1),
});

export const DlcWorkStatusSchema = z.enum([
	"ready",
	"running",
	"stopping",
	"implemented",
	"failed",
	"cancelled",
	"interrupted",
]);
export const DlcAttemptStatusSchema = z.enum([
	"running",
	"stopping",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
]);
export const DlcProjectionSchema = z.strictObject({
	intentId: z.string(),
	title: z.string(),
	request: z.string(),
	profile: ExecutionProfileSchema,
	workflowStatus: z.enum(["in-flight", "complete", "archived"]),
	stages: z.array(StageProjectionSchema.extend({ name: z.string() })),
	routingReason: z.string(),
	revision: z.number().int().nonnegative(),
	stage: z.enum(["planning", "implementing", "awaiting-review"]),
	workItems: z.array(
		z.strictObject({
			id: z.string(),
			title: z.string(),
			status: DlcWorkStatusSchema,
			attemptCount: z.number().int().nonnegative(),
			attempts: z.array(
				z.strictObject({
					id: z.string(),
					status: DlcAttemptStatusSchema,
					detail: z.string().nullable(),
				}),
			),
			detail: z.string().nullable(),
		}),
	),
	canRun: z.boolean(),
	canCancel: z.boolean(),
});
export type DlcProjection = z.infer<typeof DlcProjectionSchema>;

/** 一覧の表示は保存済み進捗から生成し、UI の選択状態は含めない。 */
export const IntentSummarySchema = z.strictObject({
	intentId: z.uuid(),
	title: z.string(),
	status: z.enum([
		"idle",
		"running",
		"stopping",
		"review",
		"complete",
		"archived",
		"attention",
	]),
});
export type IntentSummary = z.infer<typeof IntentSummarySchema>;

/** 展開位置はエディタ専用の利用者状態で、Intent の管理ファイルには保存しない。 */
export const DlcEditorStateSchema = z.strictObject({
	expanded: z.record(
		z.uuid(),
		z.array(z.number().int().min(0).max(4)).max(5),
	),
});
export type DlcEditorState = z.infer<typeof DlcEditorStateSchema>;

/** DLC の要求は Intent の識別子と期待版を伴い、遅延した画面操作を拒否できる。 */
export const DlcUiMessageSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("dlc/open"),
		requestId: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("dlc/chat"),
		requestId: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("dlc/editorState"),
		requestId: z.string().min(1),
		state: DlcEditorStateSchema,
	}),
	z.strictObject({
		type: z.literal("dlc/read"),
		requestId: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("dlc/create"),
		requestId: z.string().min(1),
		request: z.string().min(1).max(16000),
		title: z.string().trim().min(1).max(256),
		profile: ExecutionProfileSchema,
		projectType: DlcProjectTypeSchema.optional(),
	}),
	z.strictObject({
		type: z.literal("dlc/select"),
		requestId: z.string().min(1),
		intentId: z.uuid(),
	}),
	z.strictObject({
		type: z.literal("dlc/action"),
		requestId: z.string().min(1),
		intentId: z.uuid(),
		revision: z.number().int().nonnegative(),
		action: DlcActionSchema,
	}),
	z.strictObject({
		type: z.literal("dlc/recover"),
		requestId: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("dlc/backend"),
		requestId: z.string().min(1),
		backend: z.enum(["pi", "codex"]),
	}),
	z.strictObject({
		type: z.literal("ui/setMode"),
		requestId: z.string().min(1),
		mode: z.enum(["chat", "dlc"]),
	}),
	z.strictObject({
		type: z.literal("dlc/attempt"),
		requestId: z.string().min(1),
		intentId: z.uuid(),
		attemptId: z.string().min(1),
	}),
]);
export type DlcUiMessage = z.infer<typeof DlcUiMessageSchema>;
export const DlcViewSchema = z.strictObject({
	mode: z.enum(["chat", "dlc"]),
	backend: z.enum(["pi", "codex"]),
	intents: z.array(IntentSummarySchema),
	environment: z
		.strictObject({ workspace: z.string(), branch: z.string().nullable() })
		.nullable(),
	selected: DlcProjectionSchema.nullable(),
	error: z.string().nullable(),
	active: z
		.strictObject({ intentId: z.uuid(), attemptId: z.string() })
		.nullable(),
	execution: z
		.strictObject({ attemptId: z.string(), prompt: z.string() })
		.nullable(),
});
export type DlcView = z.infer<typeof DlcViewSchema>;
