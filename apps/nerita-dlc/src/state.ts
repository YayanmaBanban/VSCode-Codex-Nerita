// Intent の集約を検証する。本文と実行記録は保存境界で別ファイルに分離する。
import { z } from "zod";
import {
	DlcTaskSchema,
	DlcWorkStatusSchema,
	DlcAttemptStatusSchema,
	DlcProjectionSchema,
	ExecutionProfileSchema,
	StageProjectionSchema,
	type DlcProjection,
} from "@nerita/shared/dlc/contracts";
import { SemanticResultSchema, RuntimeEvidenceSchema } from "./runtime";
import { DigestSchema, ProjectTypeSchema } from "./workspace";
import { validateReferences, validateStages } from "./StageValidation";
import { catalogVersion, profileVersion, stageCatalog } from "./catalog";
import { nextStage, selectStages, type RoutingConditions } from "./routing";

export const SpaceSchema = z.strictObject({
	schemaVersion: z.literal(1),
	spaceId: z.literal("default"),
});
export const IntentDirectorySchema = z
	.string()
	.regex(/^\d{6}-[a-z0-9][a-z0-9-]{0,79}$/);
export const IntentMetadataSchema = z.strictObject({
	schemaVersion: z.literal(1),
	spaceId: z.literal("default"),
	intentId: z.uuid(),
	title: z.string().trim().min(1).max(256),
	request: z.string().min(1).max(16000),
	createdAt: z.iso.datetime(),
});
export type IntentMetadata = z.infer<typeof IntentMetadataSchema>;
export const IntentRegistrySchema = z
	.strictObject({
		schemaVersion: z.literal(1),
		revision: z.number().int().nonnegative(),
		entries: z.array(
			z.strictObject({
				intentId: z.uuid(),
				dirName: IntentDirectorySchema,
				createdAt: z.iso.datetime(),
			}),
		),
	})
	.superRefine((value, context) => {
		for (const key of ["intentId", "dirName"] as const) {
			if (
				new Set(value.entries.map((entry) => entry[key])).size !==
				value.entries.length
			) {
				context.addIssue({
					code: "custom",
					message: `Intent レジストリの ${key} が重複しています。`,
				});
			}
		}
	});
export type IntentRegistry = z.infer<typeof IntentRegistrySchema>;

export const AttemptSchema = z.strictObject({
	id: z.string().min(1),
	status: DlcAttemptStatusSchema,
	detail: z.string().nullable(),
	result: SemanticResultSchema.nullable(),
	evidence: RuntimeEvidenceSchema.nullable(),
});
export const WorkItemSchema = DlcTaskSchema.extend({
	id: z.string().min(1),
	status: DlcWorkStatusSchema,
	attempts: z.array(AttemptSchema),
}).superRefine((item, context) => {
	const last = item.attempts.at(-1);
	const expected = item.status === "implemented" ? "completed" : item.status;
	if (item.status !== "ready" && last?.status !== expected) {
		context.addIssue({
			code: "custom",
			message: "作業状態と最後の実行状態が一致しません。",
		});
	}
	if (
		item.status === "implemented" &&
		(!last || last.result === null || last.evidence === null)
	) {
		context.addIssue({
			code: "custom",
			message: "実装済みの作業には結果と根拠が必要です。",
		});
	}
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

/** 本文は intent.json から結合する。工程と手動タスクの状態はここだけで保持する。 */
export const IntentStateBodySchema = z.strictObject({
	schemaVersion: z.literal(1),
	intentId: z.uuid(),
	revision: z.number().int().nonnegative(),
	routing: z.strictObject({
		profileId: ExecutionProfileSchema,
		profileVersion: z.literal(profileVersion),
		catalogVersion: z.literal(catalogVersion),
		catalogDigest: DigestSchema,
		workspaceFingerprint: DigestSchema,
		workspaceSchemaVersion: z.literal(1),
		detectorVersion: z.literal(1),
		projectTypeSource: z.enum(["detected", "user"]),
		effectiveProjectType: ProjectTypeSchema,
	}),
	workflow: z.strictObject({
		status: z.enum(["in-flight", "complete", "archived"]),
		stages: z.array(StageProjectionSchema).length(33),
	}),
	workItems: z.array(WorkItemSchema).max(50),
});
export const IntentStateSchema = IntentStateBodySchema.extend({
	intent: IntentMetadataSchema,
}).superRefine((state, context) => {
	validateReferences(state, context);
	validateStages(state, context);
});
export type IntentState = z.infer<typeof IntentStateBodySchema> & {
	intent: IntentMetadata;
};

/** ホストが初期化を完了してから呼ぶ。分類のユーザー指定は再検出から独立して固定する。 */
export function createIntentState(
	intent: IntentMetadata,
	routing: IntentState["routing"],
	conditions: RoutingConditions = {},
): IntentState {
	const stages = selectStages(
		routing.profileId,
		routing.effectiveProjectType,
		conditions,
	).map((stage) =>
		stage.id.startsWith("0.")
			? { ...stage, status: "completed" as const }
			: stage,
	);
	return IntentStateSchema.parse({
		schemaVersion: 1,
		intentId: intent.intentId,
		intent,
		revision: 0,
		routing,
		workflow: { status: "in-flight", stages },
		workItems: [],
	});
}

/** 次の手動作業は登録順。工程ルーターを迂回して工程を完了する処理は行わない。 */
export function nextWork(state: IntentState): WorkItem | undefined {
	if (state.workflow.status !== "in-flight") {
		return undefined;
	}
	const item = state.workItems.find((work) => work.status !== "implemented");
	return item?.status === "ready" ? item : undefined;
}

/** 手動作業の実装完了はレビュー待ちとして表示し、ワークフロー完了へ変換しない。 */
export function workPhase(
	state: Pick<IntentState, "workItems">,
): "planning" | "implementing" | "awaiting-review" {
	if (state.workItems.length === 0) {
		return "planning";
	}
	return state.workItems.every((item) => item.status === "implemented")
		? "awaiting-review"
		: "implementing";
}

/** UI は独立した値だけを受け取り、進行状態を直接更新できない。 */
export function intentProjection(state: IntentState): DlcProjection {
	const busy = state.workItems.some((item) =>
		["running", "stopping"].includes(item.status),
	);
	return DlcProjectionSchema.parse({
		intentId: state.intentId,
		title: state.intent.title,
		request: state.intent.request,
		profile: state.routing.profileId,
		workflowStatus: state.workflow.status,
		stages: state.workflow.stages.map((stage, index) => ({
			...stage,
			name: stageCatalog[index]?.name ?? stage.id,
		})),
		routingReason: nextStage(state.workflow.stages).reason,
		revision: state.revision,
		stage: workPhase(state),
		workItems: state.workItems.map((item) => ({
			id: item.id,
			title: item.title,
			status: item.status,
			attemptCount: item.attempts.length,
			attempts: item.attempts.map(({ id, status, detail }) => ({
				id,
				status,
				detail,
			})),
			detail: item.attempts.at(-1)?.detail ?? null,
		})),
		canRun: !busy && nextWork(state) !== undefined,
		canCancel: busy,
	});
}

/** 異常終了は確認不能として保存し、再送や成功を推測しない。 */
export function recoverIntent(state: IntentState): IntentState {
	if (
		!state.workItems.some((item) =>
			["running", "stopping"].includes(item.status),
		)
	) {
		return state;
	}
	const workItems = state.workItems.map((item) =>
		!["running", "stopping"].includes(item.status)
			? item
			: {
					...item,
					status: "interrupted" as const,
					attempts: item.attempts.map((attempt) =>
						["running", "stopping"].includes(attempt.status)
							? {
									...attempt,
									status: "interrupted" as const,
									detail: "前回の実行は終了を確認できません。変更を確認して再試行してください。",
								}
							: attempt,
					),
				},
	);
	return { ...state, workItems, revision: state.revision + 1 };
}
