// 旧形式は移行入口でだけ受け付け、目的と証跡を Intent の集約へ変換する。
import { z } from "zod";
import {
	DlcWorkStatusSchema,
	DlcTaskSchema,
} from "@nerita/shared/dlc/contracts";
import {
	AttemptSchema,
	IntentStateSchema,
	createIntentState,
	type IntentState,
} from "./state";

export const LegacyProjectSchema = z
	.strictObject({
		schemaVersion: z.literal(1),
		id: z.uuid(),
		goal: z.string().min(1).max(16000),
		revision: z.number().int().nonnegative(),
		stage: z.enum(["planning", "implementing", "awaiting-review"]),
		workItems: z
			.array(
				DlcTaskSchema.extend({
					id: z.string().min(1),
					status: DlcWorkStatusSchema,
					attempts: z.array(
						AttemptSchema.extend({
							status: DlcWorkStatusSchema.exclude(["ready"]),
						}),
					),
				}),
			)
			.max(50),
	})
	.superRefine((value, context) => {
		const complete =
			value.workItems.length > 0 &&
			value.workItems.every((item) => item.status === "implemented");
		if (
			(value.stage === "planning" && value.workItems.length > 0) ||
			(value.stage === "awaiting-review") !== complete
		) {
			context.addIssue({
				code: "custom",
				message: "旧状態の段階と作業が一致しません。",
			});
		}
	});

/** 移行は初期化だけを記録し、手動タスクの終了を正式な工程通過へ変換しない。 */
export function migrateLegacy(
	value: unknown,
	routing: IntentState["routing"],
	createdAt: string,
): IntentState {
	const legacy = LegacyProjectSchema.parse(value);
	const state = createIntentState(
		{
			schemaVersion: 1,
			spaceId: "default",
			intentId: legacy.id,
			request: legacy.goal,
			title: legacy.goal.trim().slice(0, 256),
			createdAt,
		},
		routing,
	);
	const workItems = legacy.workItems.map((item) => ({
		...item,
		attempts: item.attempts.map((attempt) => ({
			...attempt,
			status:
				attempt.status === "implemented" ? "completed" : attempt.status,
		})),
	}));
	return IntentStateSchema.parse({ ...state, workItems });
}
