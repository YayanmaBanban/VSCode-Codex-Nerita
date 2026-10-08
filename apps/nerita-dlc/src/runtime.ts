// プロバイダーのセッションや SDK を持ち込まず、作業と実測した根拠だけを受け渡す。
import { z } from "zod";
import { DlcPathSchema, DlcTaskSchema } from "@nerita/shared/dlc/contracts";

export const SourceSnapshotSchema = z.strictObject({
	id: z.string().min(1),
	baseCommit: z.string().min(1),
	indexDigest: z.string().min(1),
	complete: z.boolean(),
	files: z.array(
		z.strictObject({ path: DlcPathSchema, digest: z.string().min(1) }),
	),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const RuntimeEvidenceSchema = z.strictObject({
	attemptId: z.string(),
	workItemId: z.string(),
	outcome: z.enum(["completed", "failed", "cancelled"]),
	before: SourceSnapshotSchema,
	after: SourceSnapshotSchema,
	tools: z.array(
		z.strictObject({
			id: z.string(),
			kind: z.string(),
			status: z.enum(["completed", "failed", "cancelled", "unknown"]),
			paths: z.array(DlcPathSchema),
			exitCode: z.number().int().optional(),
		}),
	),
	approvals: z.array(
		z.strictObject({
			requestId: z.string(),
			optionId: z.string(),
			kind: z.enum(["allow", "deny", "abort"]),
		}),
	),
	policy: z.literal("workspace-inherit"),
});
export type RuntimeEvidence = z.infer<typeof RuntimeEvidenceSchema>;

export const SemanticResultSchema = z.strictObject({
	attemptId: z.string(),
	workItemId: z.string(),
	outcome: z.enum(["implemented", "blocked"]),
	summary: z.string().min(1).max(16000),
	changedPaths: z.array(DlcPathSchema).max(100),
});
export type SemanticResult = z.infer<typeof SemanticResultSchema>;

/** 方針の拡張や未対応の継続方式は、実行前に Runtime が拒否する。 */
export const ExecutionRequestSchema = DlcTaskSchema.extend({
	projectId: z.string(),
	goal: z.string(),
	workItemId: z.string(),
	attemptId: z.string(),
	continuity: z.enum(["fresh", "continue", "handoff"]),
	policy: z.enum(["workspace-inherit", "read-only"]),
});
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;
export type RuntimeResult = { semantic: unknown; evidence: RuntimeEvidence };
export type RuntimeStatus = { attemptId: string | null; running: boolean };

/** 根拠は Runtime が発行する。エージェントの JSON を根拠として受け付けない。 */
export type NeritaRuntimePort = {
	run(request: ExecutionRequest, signal: AbortSignal): Promise<RuntimeResult>;
	stop(attemptId: string): Promise<void>;
	status(): RuntimeStatus;
};
