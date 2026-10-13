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
	artifacts: z
		.array(
			z.strictObject({ path: DlcPathSchema, digest: z.string().min(1) }),
		)
		.optional(),
});
/** 実行対象のソース識別情報。外部入力は `SourceSnapshotSchema` で検証してから扱う。 */
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
/** 作業と実行世代に結び付いた実行根拠。外部入力は `RuntimeEvidenceSchema` で検証してから扱う。 */
export type RuntimeEvidence = z.infer<typeof RuntimeEvidenceSchema>;

export const SemanticResultSchema = z.strictObject({
	attemptId: z.string(),
	workItemId: z.string(),
	outcome: z.enum(["implemented", "blocked"]),
	summary: z.string().min(1).max(16000),
	changedPaths: z.array(DlcPathSchema).max(100),
});
/** 実行結果の内容。外部入力は `SemanticResultSchema` で検証してから扱う。 */
export type SemanticResult = z.infer<typeof SemanticResultSchema>;

/** 方針の拡張や未対応の継続方式は、実行前に Runtime が拒否する。 */
export const ExecutionRequestSchema = DlcTaskSchema.extend({
	intentId: z.uuid(),
	request: z.string(),
	workItemId: z.string(),
	attemptId: z.string(),
	continuity: z.enum(["fresh", "continue", "handoff"]),
	policy: z.enum(["workspace-inherit", "read-only"]),
});
/** 実行世代と対象を指定する要求。実行境界では `ExecutionRequestSchema` で検証する。 */
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;
/** 内容未検証の実行結果と根拠。利用側は結果を検証し、根拠の作業 ID と実行世代も照合する。 */
export type RuntimeResult = { semantic: unknown; evidence: RuntimeEvidence };
/** 会話の保存に失敗しても、実行要求に結び付いた収集済みの結果をエラーに含めて渡す。 */
export class RuntimeResultError extends Error {
	/** 失敗時にも実測結果を上位へ渡し、エラーメッセージだけで実行結果を失わない。 */
	constructor(
		message: string,
		readonly result: RuntimeResult,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "RuntimeResultError";
	}
}
/** 実行中の世代と稼働状態。実行世代がない場合は `attemptId` を `null` にする。 */
export type RuntimeStatus = { attemptId: string | null; running: boolean };

/** 根拠は Runtime が発行する。エージェントの JSON を根拠として受け付けない。 */
export type NeritaRuntimePort = {
	/** 実行先の検証・予約を状態更新より先に行い、終了確認まで保持する。 */
	withAdmission?<T>(
		operation: () => Promise<T>,
		signal: AbortSignal,
	): Promise<T>;
	run(request: ExecutionRequest, signal: AbortSignal): Promise<RuntimeResult>;
	stop(attemptId: string): Promise<void>;
	status(): RuntimeStatus;
};
