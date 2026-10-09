// 実行世代と実測した差分を照合して状態を遷移させる。レビューの完了は扱わない。
import { DlcActionSchema } from "@nerita/shared/dlc/contracts";
import { nextStage } from "./routing";
import { type IntentState, type WorkItem, nextWork, workPhase } from "./state";
import {
	RuntimeEvidenceSchema,
	SemanticResultSchema,
	type RuntimeResult,
	type RuntimeEvidence,
	type SemanticResult,
} from "./runtime";

/** UI の操作では、結果の確定や進行中の状態の上書きを許さない。 */
export function applyAction(state: IntentState, value: unknown): IntentState {
	const action = DlcActionSchema.parse(value);
	if (action.type === "advance") {
		const next = nextStage(state.workflow.stages);
		throw new Error(
			next.stageId === null
				? "ワークフローは完了しています。"
				: `${next.stageId}: ${next.reason}`,
		);
	}
	if (action.type === "archive") {
		return archiveIntent(state);
	}
	if (state.workflow.status !== "in-flight") {
		throw new Error("この Intent は作業中ではありません。");
	}
	if (action.type === "plan") {
		if (workPhase(state) !== "planning") {
			throw new Error("プランは既に確定しています。");
		}
		const workItems = action.tasks.map((task, index): WorkItem => ({
			...task,
			id: `${state.intentId}:task:${index + 1}`,
			status: "ready",
			attempts: [],
		}));
		return {
			...state,
			revision: state.revision + 1,
			workItems,
		};
	}
	if (action.type !== "retry") {
		throw new Error("実行と停止はコントローラーへ要求してください。");
	}
	return retryWork(state, action.workItemId);
}

/** 実行前に永続化するための状態を作る。同時実行と同一世代の再利用は拒否する。 */
export function beginWork(state: IntentState, attemptId: string): IntentState {
	if (
		state.workItems.some((item) =>
			["running", "stopping"].includes(item.status),
		)
	) {
		throw new Error("DLC は既に実行中です。");
	}
	if (
		state.workItems.some((item) =>
			item.attempts.some((attempt) => attempt.id === attemptId),
		)
	) {
		throw new Error("実行世代が重複しています。");
	}
	const item = nextWork(state);
	if (!item) {
		throw new Error("実行できる作業がありません。");
	}
	return replaceItem(state, {
		...item,
		status: "running",
		attempts: [
			...item.attempts,
			{
				id: attemptId,
				status: "running",
				detail: null,
				result: null,
				evidence: null,
			},
		],
	});
}

/** 古い実行・停止後の成功・捏造された根拠を現在の実行へ反映しない。 */
export function finishWork(
	state: IntentState,
	attemptId: string,
	receipt: RuntimeResult,
): IntentState {
	const item = currentItem(state, attemptId);
	if (!item) {
		return state;
	}
	const result = boundSemanticResult(receipt.semantic, attemptId, item.id);
	const evidence = boundEvidence(receipt.evidence, attemptId, item.id);
	if (item.status === "stopping" || evidence.outcome === "cancelled") {
		return finishItem(state, item, "cancelled", "実行を停止しました。", {
			result: result ?? null,
			evidence,
		});
	}
	if (result === undefined) {
		return finishItem(
			state,
			item,
			"failed",
			"構造化された結果が不正、または作業・実行世代が一致しません。",
			{ result: null, evidence },
		);
	}
	const problem =
		evidence.outcome === "completed"
			? evidenceProblem(item, result.changedPaths, evidence)
			: "Runtime の実行は正常に終了していません。";
	const status =
		result.outcome === "implemented" && problem === null
			? "implemented"
			: "failed";
	return finishItem(state, item, status, problem ?? result.summary, {
		result,
		evidence,
	});
}

/** 実行要求に結び付いた意味上の結果だけを、型付きのデータへ変換する。 */
function boundSemanticResult(
	value: unknown,
	attemptId: string,
	workItemId: string,
): SemanticResult | undefined {
	const parsed = SemanticResultSchema.safeParse(value);
	return parsed.success &&
		parsed.data.attemptId === attemptId &&
		parsed.data.workItemId === workItemId
		? parsed.data
		: undefined;
}

function boundEvidence(
	value: unknown,
	attemptId: string,
	workItemId: string,
): RuntimeEvidence {
	const evidence = RuntimeEvidenceSchema.parse(value);
	if (
		evidence.attemptId !== attemptId ||
		evidence.workItemId !== workItemId
	) {
		throw new Error("結果と根拠の作業・実行世代が一致しません。");
	}
	return evidence;
}

/** 中止と失敗を区別し、結果が来なかった実行にも終端状態を残す。 */
export function failWork(
	state: IntentState,
	attemptId: string,
	status: "failed" | "cancelled",
	detail: string,
): IntentState {
	const item = currentItem(state, attemptId);
	return item ? finishItem(state, item, status, detail, {}) : state;
}

/** 停止の要求を先に確定し、遅れて届く成功を受け付けない。 */
export function requestStop(
	state: IntentState,
	attemptId: string,
): IntentState {
	const item = currentItem(state, attemptId);
	return item
		? finishItem(state, item, "stopping", "停止処理中です。", {})
		: state;
}

function currentItem(state: IntentState, attemptId: string) {
	return state.workItems.find(
		(item) =>
			["running", "stopping"].includes(item.status) &&
			item.attempts.at(-1)?.id === attemptId,
	);
}
function replaceItem(state: IntentState, item: WorkItem): IntentState {
	const workItems = state.workItems.map((work) =>
		work.id === item.id ? item : work,
	);
	return {
		...state,
		workItems,
		revision: state.revision + 1,
	};
}
function finishItem(
	state: IntentState,
	item: WorkItem,
	status: WorkItem["status"],
	detail: string,
	receipt: Partial<WorkItem["attempts"][number]>,
): IntentState {
	return replaceItem(state, {
		...item,
		status,
		attempts: item.attempts.map((attempt, index) =>
			index === item.attempts.length - 1
				? {
						...attempt,
						...receipt,
						status: attemptStatus(status),
						detail,
					}
				: attempt,
		),
	});
}

/** 成功した書込み通知と前後のファイル内容の両方が必要。テスト成功や意味の正しさは推測しない。 */
function evidenceProblem(
	item: WorkItem,
	claims: string[],
	evidence: RuntimeResult["evidence"],
): string | null {
	if (
		!evidence.before.complete ||
		!evidence.after.complete ||
		evidence.before.baseCommit !== evidence.after.baseCommit
	) {
		return "ソースの収集が不完全、または基準コミットが変更されています。";
	}
	const before = new Map(
		evidence.before.files.map((file) => [file.path, file.digest]),
	);
	const after = new Map(
		evidence.after.files.map((file) => [file.path, file.digest]),
	);
	const paths = [...new Set([...before.keys(), ...after.keys()])].filter(
		(path) => before.get(path) !== after.get(path),
	);
	if (paths.length === 0 || claims.length === 0) {
		return "実際のソース変更を確認できません。";
	}
	if (
		paths.some((path) => !item.paths.includes(path)) ||
		claims.some((path) => !paths.includes(path))
	) {
		return "実測した差分が作業の対象、または申告された変更と一致しません。";
	}
	const writes = evidence.tools
		.filter(
			(tool) =>
				tool.status === "completed" &&
				["edit", "write"].includes(tool.kind),
		)
		.flatMap((tool) => tool.paths);
	if (
		paths.some((path) => !claims.includes(path) || !writes.includes(path))
	) {
		return "差分に対応する成功した書込み通知を確認できません。";
	}
	if (
		evidence.tools.some(
			(tool) =>
				tool.status !== "completed" ||
				(tool.exitCode !== undefined && tool.exitCode !== 0),
		)
	) {
		return "失敗または未完了のツール実行があります。";
	}
	return null;
}

function retryWork(state: IntentState, workItemId: string): IntentState {
	if (
		state.workItems.some((item) =>
			["running", "stopping"].includes(item.status),
		)
	) {
		throw new Error("実行中は再試行できません。");
	}
	const item = state.workItems.find((work) => work.id === workItemId);
	if (
		!item ||
		!["failed", "cancelled", "interrupted"].includes(item.status)
	) {
		throw new Error("この作業は再試行できません。");
	}
	return replaceItem(state, { ...item, status: "ready" });
}
function archiveIntent(state: IntentState): IntentState {
	if (
		state.workItems.some((item) =>
			["running", "stopping"].includes(item.status),
		)
	) {
		throw new Error("実行中はアーカイブできません。");
	}
	if (state.workflow.status === "archived") {
		return state;
	}
	return {
		...state,
		revision: state.revision + 1,
		workflow: { ...state.workflow, status: "archived" },
	};
}

function attemptStatus(
	status: WorkItem["status"],
): WorkItem["attempts"][number]["status"] {
	if (status === "implemented") {
		return "completed";
	}
	if (status === "ready") {
		return "failed";
	}
	return status;
}
