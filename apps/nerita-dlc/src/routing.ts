// 保存済みの適用判断に従い、次の工程と停止理由を決める。
import type { z } from "zod";
import {
	type StageProjectionSchema,
	type ExecutionProfile,
} from "@nerita/shared/dlc/contracts";
import {
	stageCatalog,
	validateCatalog,
	type StageCondition,
	type StageDefinition,
} from "./catalog";
import type { WorkspaceDetection } from "./workspace";

/** 工程選択に使う条件。未指定は未確定として扱い、常時実行とプロジェクト分類は別に判定する。 */
export type RoutingConditions = Partial<
	Record<Exclude<StageCondition, "always" | "brownfield">, boolean>
>;
/** 工程の表示状態。外部入力は `StageProjectionSchema` で検証してから扱う。 */
export type StageState = z.infer<typeof StageProjectionSchema>;
/** 常時実行とプロジェクト分類を先に判定し、情報がない条件は未確定として返す。 */
function conditionValue(
	condition: StageCondition,
	projectType: WorkspaceDetection["classification"]["detected"],
	conditions: RoutingConditions,
): boolean | undefined {
	if (condition === "always") {
		return true;
	}
	if (condition === "brownfield") {
		return projectType === "unknown"
			? undefined
			: projectType === "brownfield";
	}
	return conditions[condition];
}
/** 工程の選択理由を、分類・条件・実行プロファイルのいずれかに結び付けて記録する。 */
function selectionReason(
	stage: StageDefinition,
	profile: ExecutionProfile,
	projectType: string,
	value: boolean | undefined,
): string {
	if (stage.condition === "brownfield") {
		return `workspace:${projectType}`;
	}
	if (stage.condition !== "always") {
		return `condition:${stage.condition}:${value ?? "unknown"}`;
	}
	return stage.id.startsWith("0.")
		? "initialization:always"
		: `profile:${profile}`;
}
/** 実行プロファイルと条件から工程を選び、未確定の条件を実行可能とみなさない。 */
function selectStage(
	stage: StageDefinition,
	profile: ExecutionProfile,
	projectType: WorkspaceDetection["classification"]["detected"],
	conditions: RoutingConditions,
): StageState {
	if (!stage.profiles.includes(profile)) {
		return {
			id: stage.id,
			selection: "skip",
			status: "skipped",
			reason: `profile:${profile}`,
		};
	}
	const value = conditionValue(stage.condition, projectType, conditions);
	let selection: StageState["selection"] = "undetermined";
	if (value !== undefined) {
		selection = value ? "execute" : "skip";
	}
	return {
		id: stage.id,
		selection,
		status: value === false ? "skipped" : "pending",
		reason: selectionReason(stage, profile, projectType, value),
	};
}
/** 初期化の成功は Host が確定後に記録する。ここでは全工程を未実行として生成する。 */
export function selectStages(
	profile: ExecutionProfile,
	projectType: WorkspaceDetection["classification"]["detected"],
	conditions: RoutingConditions = {},
): StageState[] {
	validateCatalog(stageCatalog);
	return stageCatalog.map((stage) =>
		selectStage(stage, profile, projectType, conditions),
	);
}
/** 依存工程・処理の対応状況・成果物を確認し、次の工程を開始できない理由を返す。 */
function readiness(
	stage: StageState,
	stages: readonly StageState[],
	handlers: ReadonlySet<string>,
	artifacts: ReadonlySet<string>,
): string {
	const definition = stageCatalog.find((item) => item.id === stage.id);
	if (!definition) {
		throw new Error("未知のステージです。");
	}
	if (stage.selection === "undetermined") {
		return `undetermined:${stage.reason}`;
	}
	if (stage.status !== "pending") {
		return `stage:${stage.status}`;
	}
	const dependency = definition.dependencies.find(
		(dependency) =>
			!stages.some(
				(item) =>
					item.id === dependency &&
					["completed", "skipped"].includes(item.status),
			),
	);
	if (dependency !== undefined) {
		return `dependency:${dependency}`;
	}
	if (!handlers.has(definition.handlerId)) {
		return "unsupported-stage";
	}
	const missing = definition.consumes.find(
		(input) =>
			stages.some(
				(item) =>
					item.id === input.stageId && item.selection === "execute",
			) && !artifacts.has(input.artifact),
	);
	return missing ? `missing-artifact:${missing.artifact}` : "ready";
}
/** 未実装・不足した入力・承認待ちは履歴を変更せず停止する。 */
export function nextStage(
	stages: readonly StageState[],
	handlers: ReadonlySet<string> = new Set(),
	artifacts: ReadonlySet<string> = new Set(),
): { stageId: string | null; reason: string } {
	const stage = stages.find(
		(stage) => !["completed", "skipped"].includes(stage.status),
	);
	return stage
		? {
				stageId: stage.id,
				reason: readiness(stage, stages, handlers, artifacts),
			}
		: { stageId: null, reason: "complete" };
}
