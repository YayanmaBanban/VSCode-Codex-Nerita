// 永続状態の形と、Goal から明示的な Plan を作業項目へ変換する規則を定義する。
import { z } from "zod";
import {
	DlcTaskSchema,
	DlcWorkStatusSchema,
	DlcProjectionSchema,
	type DlcProjection,
} from "@nerita/shared/dlc/contracts";
import { SemanticResultSchema, RuntimeEvidenceSchema } from "./runtime";

const AttemptSchema = z.strictObject({
	id: z.string().min(1),
	status: DlcWorkStatusSchema.exclude(["ready"]),
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
	if (item.status !== "ready" && last?.status !== item.status) {
		context.addIssue({
			code: "custom",
			message: "作業状態と最後の実行状態が一致しません。",
		});
	}
	if (
		item.status === "implemented" &&
		(last === undefined || last.result === null || last.evidence === null)
	) {
		context.addIssue({
			code: "custom",
			message: "実装済みの作業には結果と根拠が必要です。",
		});
	}
});
export type WorkItem = z.infer<typeof WorkItemSchema>;
export const ProjectStateSchema = z
	.strictObject({
		schemaVersion: z.literal(1),
		id: z.string().min(1),
		goal: z.string().trim().min(1).max(16000),
		revision: z.number().int().nonnegative(),
		stage: z.enum(["planning", "implementing", "awaiting-review"]),
		workItems: z.array(WorkItemSchema),
	})
	.superRefine((state, context) => {
		const workIds = state.workItems.map((item) => item.id);
		const attemptIds: string[] = [];
		for (const item of state.workItems) {
			attemptIds.push(...item.attempts.map((attempt) => attempt.id));
		}
		if (
			new Set(workIds).size !== workIds.length ||
			new Set(attemptIds).size !== attemptIds.length
		) {
			context.addIssue({
				code: "custom",
				message: "作業または実行世代の識別子が重複しています。",
			});
		}
		if (
			state.workItems.filter((item) =>
				["running", "stopping"].includes(item.status),
			).length > 1
		) {
			context.addIssue({
				code: "custom",
				message: "複数の作業が実行中です。",
			});
		}
		const allImplemented =
			state.workItems.length > 0 &&
			state.workItems.every((item) => item.status === "implemented");
		if (
			(state.stage === "planning" && state.workItems.length > 0) ||
			(state.stage === "awaiting-review") !== allImplemented
		) {
			context.addIssue({
				code: "custom",
				message: "プロジェクトの段階と作業状態が一致しません。",
			});
		}
	});
export type ProjectState = z.infer<typeof ProjectStateSchema>;

/** プランが入力されるまで Runtime は起動しない。 */
export function createProject(id: string, goal: string): ProjectState {
	return ProjectStateSchema.parse({
		schemaVersion: 1,
		id,
		goal,
		revision: 0,
		stage: "planning",
		workItems: [],
	});
}

/** 次の作業は登録順で選び、失敗した作業を飛ばして後続を実行しない。 */
export function nextWork(state: ProjectState): WorkItem | undefined {
	const item = state.workItems.find((work) => work.status !== "implemented");
	return item?.status === "ready" ? item : undefined;
}

/** 表示用には独立した値だけを返し、ドメイン状態の参照を渡さない。 */
export function projectProjection(state: ProjectState): DlcProjection {
	const busy = state.workItems.some((item) =>
		["running", "stopping"].includes(item.status),
	);
	return DlcProjectionSchema.parse({
		projectId: state.id,
		goal: state.goal,
		revision: state.revision,
		stage: state.stage,
		workItems: state.workItems.map((item) => ({
			id: item.id,
			title: item.title,
			status: item.status,
			attemptCount: item.attempts.length,
			detail: item.attempts.at(-1)?.detail ?? null,
		})),
		canRun: !busy && nextWork(state) !== undefined,
		canCancel: busy,
	});
}

/** プロセスを再起動した実行は失敗や再送と区別し、明示的な再試行を待つ。 */
export function recoverProject(state: ProjectState): ProjectState {
	if (
		!state.workItems.some((item) =>
			["running", "stopping"].includes(item.status),
		)
	) {
		return state;
	}
	const workItems = state.workItems.map((item) => {
		if (!["running", "stopping"].includes(item.status)) {
			return item;
		}
		return {
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
		};
	});
	return { ...state, workItems, revision: state.revision + 1 };
}
