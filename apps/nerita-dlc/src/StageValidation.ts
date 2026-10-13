// 集約状態の参照と進行順を確認する。Zod によるデータ形式の検証とは別に、状態の組み合わせを検証する。
import type { z } from "zod";
import { stageCatalog } from "./catalog";
import type { IntentState } from "./state";

/** 依頼・作業・実行記録の参照整合性を検証する。構造検証後の状態を渡し、失敗は検証コンテキストへ記録する。 */
export function validateReferences(
	state: IntentState,
	context: z.RefinementCtx,
): void {
	if (state.intentId !== state.intent.intentId) {
		context.addIssue({
			code: "custom",
			message: "Intent 本文と状態の ID が一致しません。",
		});
	}
	const workIds = state.workItems.map((item) => item.id);
	const attempts = state.workItems.flatMap((item) => item.attempts);
	const matchesSize =
		new Set(workIds).size !== workIds.length ||
		new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length;
	if (matchesSize) {
		context.addIssue({
			code: "custom",
			message: "作業または実行世代の識別子が重複しています。",
		});
	}
	const matchesLength =
		state.workItems.filter((item) =>
			["running", "stopping"].includes(item.status),
		).length > 1;
	if (matchesLength) {
		context.addIssue({
			code: "custom",
			message: "複数の作業が実行中です。",
		});
	}
	for (const item of state.workItems) {
		validateAttempts(item, context);
	}
}
/** 実行記録に添付された根拠が、その実行世代と所属作業を参照しているかを検証する。 */
function validateAttempts(
	item: IntentState["workItems"][number],
	context: z.RefinementCtx,
): void {
	for (const attempt of item.attempts) {
		const invalidEvidenceReference =
			attempt.evidence &&
			(attempt.evidence.attemptId !== attempt.id ||
				attempt.evidence.workItemId !== item.id);
		if (invalidEvidenceReference === true) {
			context.addIssue({
				code: "custom",
				message: "実行記録の参照が一致しません。",
			});
		}
	}
}
/** 工程の順序と選択・実行状態の組み合わせが、カタログの定義と一致するかを判定する。 */
function validStage(
	stage: IntentState["workflow"]["stages"][number],
	index: number,
): boolean {
	const matchesId = !(
		stage.id === stageCatalog[index]?.id &&
		(stage.selection === "skip") === (stage.status === "skipped")
	);
	if (matchesId) {
		return false;
	}
	return stage.selection !== "undetermined" || stage.status === "pending";
}
/** 工程の順序と進行の整合性を検証する。構造検証後の状態を渡し、失敗は検証コンテキストへ記録する。 */
export function validateStages(
	state: IntentState,
	context: z.RefinementCtx,
): void {
	let open = false;
	let active = 0;
	for (const [index, stage] of state.workflow.stages.entries()) {
		if (!validStage(stage, index)) {
			context.addIssue({
				code: "custom",
				message: "ステージの選択または順序が不正です。",
			});
		}
		if (open && !["pending", "skipped"].includes(stage.status)) {
			context.addIssue({
				code: "custom",
				message: "未完了ステージより先に進行しています。",
			});
		}
		const matchesIncludes = [
			"active",
			"awaiting-approval",
			"revising",
		].includes(stage.status);
		if (matchesIncludes) {
			active++;
		}
		if (!["completed", "skipped"].includes(stage.status)) {
			open = true;
		}
	}
	if (active > 1) {
		context.addIssue({
			code: "custom",
			message: "複数の工程が進行中です。",
		});
	}
	if (state.workflow.status === "complete" && open) {
		context.addIssue({
			code: "custom",
			message: "ワークフローとステージの状態が一致しません。",
		});
	}
}
