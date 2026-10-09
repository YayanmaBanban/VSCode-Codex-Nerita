// 一覧の状態は検証済みの進捗から生成し、実行状態の判定を UI へ委ねない。
import type {
	DlcProjection,
	IntentSummary,
} from "@nerita/shared/dlc/contracts";

export function intentSummary(projection: DlcProjection): IntentSummary {
	const statuses = projection.workItems.map((item) => item.status);
	let status: IntentSummary["status"] = "idle";
	if (statuses.includes("stopping")) {
		status = "stopping";
	} else if (statuses.includes("running")) {
		status = "running";
	} else if (projection.workflowStatus === "archived") {
		status = "archived";
	} else if (projection.workflowStatus === "complete") {
		status = "complete";
	} else if (
		statuses.some((value) =>
			["interrupted", "failed", "cancelled"].includes(value),
		)
	) {
		status = "attention";
	} else if (projection.stage === "awaiting-review") {
		status = "review";
	}
	return { intentId: projection.intentId, title: projection.title, status };
}
