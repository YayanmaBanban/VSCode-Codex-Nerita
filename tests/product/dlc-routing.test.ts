// 上流の静的な各セルを固定した期待値と照合し、件数だけ一致する誤りも検出する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { stageCatalog, validateCatalog } from "@nerita/dlc/catalog";
import { selectStages, nextStage } from "@nerita/dlc/routing";
import { IntentStateSchema } from "@nerita/dlc/state";
import { applyAction, beginWork, finishWork } from "@nerita/dlc/transitions";
import { ExecutionProfileSchema } from "@nerita/shared/dlc/contracts";
import { currentCatalogDigest } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import {
	createTestIntent,
	plannedIntent,
	executionReceipt,
} from "../support/dlc";

// AWS docs/guide/05-scopes-and-depth.md の Stage-by-Scope Matrix（2026-10-08）。
const matrix = {
	enterprise:
		"0.1 0.2 0.3 1.1 1.2 1.3 1.4 1.5 1.6 1.7 2.1 2.2 2.3 2.4 2.5 2.6 2.7 2.8 2.9 3.1 3.2 3.3 3.4 3.5 3.6 3.7 4.1 4.2 4.3 4.4 4.5 4.6 4.7",
	feature:
		"0.1 0.2 0.3 1.1 1.2 1.3 1.4 1.5 1.6 1.7 2.1 2.2 2.3 2.4 2.5 2.6 2.7 2.8 2.9 3.1 3.2 3.3 3.4 3.5 3.6 3.7 4.1 4.2 4.3 4.4 4.5 4.6 4.7",
	mvp: "0.1 0.2 0.3 1.1 1.3 1.4 1.6 2.1 2.2 2.3 2.4 2.5 2.6 2.7 2.8 2.9 3.1 3.2 3.3 3.4 3.5 3.6 3.7",
	poc: "0.1 0.2 0.3 1.1 2.1 2.3 3.5 3.6",
	bugfix: "0.1 0.2 0.3 2.1 2.3 3.5 3.6 4.1 4.3",
	refactor: "0.1 0.2 0.3 2.1 2.3 3.1 3.5 3.6 4.1 4.3",
	infra: "0.1 0.2 0.3 2.2 2.3 3.2 3.3 3.4 3.7 4.1 4.2 4.3 4.4",
	"security-patch": "0.1 0.2 0.3 2.1 2.3 3.2 3.5 3.6 4.1 4.3",
	classic:
		"0.1 0.2 0.3 2.1 2.2 2.3 2.4 2.5 2.6 2.7 2.8 2.9 3.1 3.2 3.3 3.4 3.5 3.6",
	workshop:
		"0.1 0.2 0.3 2.1 2.2 2.3 2.4 2.5 2.6 2.7 2.8 2.9 3.1 3.2 3.3 3.4 3.5 3.6 3.7 4.1 4.2 4.3 4.4 4.5 4.6 4.7",
	express: "0.1 0.2 0.3 2.1 2.3 3.5 3.6 4.1 4.3 4.4",
} as const;
for (const [key, expected] of Object.entries(matrix)) {
	const profile = ExecutionProfileSchema.parse(key);
	void test(`${profile} の各ステージは一次資料の静的選択と一致する`, () => {
		assert.deepEqual(
			stageCatalog
				.filter((stage) => stage.profiles.includes(profile))
				.map((stage) => stage.id),
			expected.split(" "),
		);
	});
}
void test("カタログの欠落・重複・並び順・循環・未解決の成果物を拒否する", () => {
	assert.doesNotThrow(() => validateCatalog(stageCatalog));
	assert.throws(() => validateCatalog(stageCatalog.slice(1)));
	const duplicate = structuredClone(stageCatalog);
	duplicate[1]!.id = duplicate[0]!.id;
	assert.throws(() => validateCatalog(duplicate));
	const cycle = structuredClone(stageCatalog);
	cycle[0]!.dependencies = ["4.7"];
	assert.throws(() => validateCatalog(cycle));
	const artifact = structuredClone(stageCatalog);
	artifact[1]!.consumes = [{ stageId: "0.1", artifact: "absent" }];
	assert.throws(() => validateCatalog(artifact));
	assert.equal(
		currentCatalogDigest,
		"sha256:a7d09ec771ccf16e7b1e5f2d43ac292aed1ffdf255d7c8441a672a6ee6c3815a",
	);
	assert.deepEqual(
		stageCatalog
			.filter((stage) => stage.repetition === "unit")
			.map((stage) => stage.id),
		["3.1", "3.2", "3.3", "3.4", "3.5"],
	);
});
void test("分類と未知の条件を静的選択から分け、未実装・入力不足では履歴を変更しない", () => {
	const brown = selectStages("classic", "brownfield");
	const green = selectStages("classic", "greenfield");
	const unknown = selectStages("classic", "unknown");
	assert.equal(
		brown.find((stage) => stage.id === "2.1")?.selection,
		"execute",
	);
	assert.equal(green.find((stage) => stage.id === "2.1")?.status, "skipped");
	assert.equal(
		unknown.find((stage) => stage.id === "2.1")?.selection,
		"undetermined",
	);
	assert.equal(
		brown.find((stage) => stage.id === "2.5")?.selection,
		"undetermined",
	);
	assert.equal(
		selectStages("classic", "greenfield", { ui: false }).find(
			(stage) => stage.id === "2.5",
		)?.status,
		"skipped",
	);
	const stages = createTestIntent().workflow.stages;
	const before = structuredClone(stages);
	assert.deepEqual(nextStage(stages), {
		stageId: "2.1",
		reason: "unsupported-stage",
	});
	assert.equal(
		nextStage(stages, new Set(["stage:2.1"])).reason,
		"missing-artifact:state",
	);
	assert.equal(
		nextStage(stages, new Set(["stage:2.1"]), new Set(["state"])).reason,
		"ready",
	);
	assert.deepEqual(stages, before);
	assert.throws(
		() => applyAction(createTestIntent(), { type: "advance" }),
		/unsupported-stage/,
	);
});
void test("手動実装の完了・初期化・ワークフローを混同せず、不正な進行を拒否する", () => {
	const initial = plannedIntent();
	const complete = finishWork(
		beginWork(initial, "attempt"),
		"attempt",
		executionReceipt(),
	);
	assert.equal(complete.workItems[0]!.attempts[0]!.status, "completed");
	assert.equal(complete.workItems[0]?.status, "implemented");
	assert.deepEqual(complete.workflow, initial.workflow);
	assert.equal(
		IntentStateSchema.safeParse({
			...complete,
			workflow: { ...complete.workflow, status: "complete" },
		}).success,
		false,
	);
	for (const status of [
		"completed",
		"skipped",
		"awaiting-approval",
		"revising",
	] as const) {
		const changed = structuredClone(initial);
		changed.workflow.stages.find((stage) => stage.id === "2.3")!.status =
			status;
		assert.equal(IntentStateSchema.safeParse(changed).success, false);
	}
	assert.throws(() =>
		applyAction(initial, { type: "complete", stageId: "2.1" }),
	);
});
