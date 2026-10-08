// 公開コントローラーと状態遷移から、自己申告・世代違い・停止・保存失敗の扱いを確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { DlcController } from "@nerita/dlc/controller";
import {
	createProject,
	projectProjection,
	type ProjectState,
} from "@nerita/dlc/state";
import { applyAction, beginWork, finishWork } from "@nerita/dlc/transitions";
import type {
	ExecutionRequest,
	RuntimeResult,
	NeritaRuntimePort,
} from "@nerita/dlc/runtime";
import {
	plannedProject,
	executionReceipt,
	successfulRuntime,
} from "../support/dlc";

void test("Goal と Plan を登録し、実測した変更を伴う実装結果でレビュー待ちになる", () => {
	const goal = createProject("project", "挨拶を変更する");
	assert.equal(projectProjection(goal).canRun, false);
	const running = beginWork(plannedProject(), "attempt");
	const state = finishWork(running, "attempt", executionReceipt());
	assert.equal(state.stage, "awaiting-review");
	assert.equal(state.workItems[0]?.status, "implemented");
	assert.equal(
		state.workItems[0].attempts[0]?.evidence?.tools[0]?.status,
		"completed",
	);
});

const missingEvidence = [
	{
		name: "Runtime の失敗",
		edit: (value: RuntimeResult) => {
			value.evidence.outcome = "failed";
		},
	},
	{
		name: "自己申告だけで変更なし",
		edit: (value: RuntimeResult) => {
			value.evidence.after = value.evidence.before;
		},
	},
	{
		name: "書込み通知なし",
		edit: (value: RuntimeResult) => {
			value.evidence.tools = [];
		},
	},
	{
		name: "不完全なソース収集",
		edit: (value: RuntimeResult) => {
			value.evidence.after.complete = false;
		},
	},
	{
		name: "基準コミットの変更",
		edit: (value: RuntimeResult) => {
			value.evidence.after.baseCommit = "other";
		},
	},
	{
		name: "対象外の変更",
		edit: (value: RuntimeResult) => {
			value.evidence.after.files.push({
				path: "other.txt",
				digest: "new",
			});
		},
	},
	{
		name: "ツールの失敗",
		edit: (value: RuntimeResult) => {
			value.evidence.tools[0]!.status = "failed";
		},
	},
	{
		name: "非ゼロの終了コード",
		edit: (value: RuntimeResult) => {
			value.evidence.tools[0]!.exitCode = 1;
		},
	},
];
for (const scenario of missingEvidence) {
	void test(`${scenario.name}では実装済みに進まない`, () => {
		const receipt = executionReceipt();
		scenario.edit(receipt);
		const state = finishWork(
			beginWork(plannedProject(), "attempt"),
			"attempt",
			receipt,
		);
		assert.equal(state.workItems[0]?.status, "failed");
		assert.equal(state.stage, "implementing");
	});
}

void test("旧世代の遅延結果と別作業の結果を受け付けない", () => {
	const running = beginWork(plannedProject(), "current");
	assert.equal(finishWork(running, "old", executionReceipt("old")), running);
	assert.throws(
		() =>
			finishWork(
				running,
				"current",
				executionReceipt("current", "other-work"),
			),
		/一致しません/,
	);
	assert.throws(() =>
		applyAction(running, { type: "finish", status: "implemented" }),
	);
});

void test("表示データを書き換えてもドメインの状態は変わらない", () => {
	const state = plannedProject();
	const view = projectProjection(state);
	view.workItems[0]!.status = "implemented";
	assert.equal(projectProjection(state).workItems[0]?.status, "ready");
});

void test("構造化結果が不正でも実測した根拠を失敗した実行に残す", () => {
	const receipt = executionReceipt();
	receipt.semantic = { outcome: "implemented", executed: true };
	const state = finishWork(
		beginWork(plannedProject(), "attempt"),
		"attempt",
		receipt,
	);
	assert.equal(state.workItems[0]?.status, "failed");
	const attempt = state.workItems[0].attempts[0];
	assert.equal(attempt?.result, null);
	assert.equal(attempt.evidence?.after.id, "after");
});

void test("クラッシュした実行は中断として復旧し、明示的な再試行で新しい世代を使う", async () => {
	let saved: ProjectState | undefined;
	let launches = 0;
	const controller = await DlcController.open(
		beginWork(plannedProject(), "crashed"),
		successfulRuntime(() => {
			launches += 1;
		}),
		{
			save: (state) => {
				saved = state;
				return Promise.resolve();
			},
		},
		() => "new-attempt",
	);
	assert.equal(controller.projection().workItems[0]?.status, "interrupted");
	await assert.rejects(
		controller.dispatch({ type: "run" }),
		/実行できる作業/,
	);
	assert.equal(launches, 0);
	await controller.dispatch({ type: "retry", workItemId: "project:task:1" });
	await controller.dispatch({ type: "run" });
	assert.equal(launches, 1);
	assert.equal(saved?.workItems[0]?.attempts[0]?.status, "interrupted");
	assert.equal(saved.workItems[0].attempts[1]?.id, "new-attempt");
});

void test("二重起動を拒否し、停止後に返る成功もキャンセルとして確定する", async () => {
	let started!: (request: ExecutionRequest) => void;
	const launched = new Promise<ExecutionRequest>((resolve) => {
		started = resolve;
	});
	let complete!: (result: RuntimeResult) => void;
	const result = new Promise<RuntimeResult>((resolve) => {
		complete = resolve;
	});
	let launches = 0;
	let stops = 0;
	const runtime: NeritaRuntimePort = {
		run: (request) => {
			launches += 1;
			started(request);
			return result;
		},
		stop: () => {
			stops += 1;
			complete(executionReceipt());
			return Promise.resolve();
		},
		status: () => ({ attemptId: "attempt", running: true }),
	};
	const controller = await DlcController.open(
		plannedProject(),
		runtime,
		{ save: () => Promise.resolve() },
		() => "attempt",
	);
	const run = controller.dispatch({ type: "run" });
	await launched;
	await assert.rejects(
		controller.dispatch({ type: "run" }),
		/実行または保存中/,
	);
	await controller.dispatch({ type: "cancel" });
	await run;
	assert.equal(launches, 1);
	assert.equal(stops, 1);
	assert.equal(controller.projection().workItems[0]?.status, "cancelled");
});

void test("実行開始状態の保存に失敗したら Runtime を起動しない", async () => {
	let launches = 0;
	let saves = 0;
	const controller = await DlcController.open(
		plannedProject(),
		successfulRuntime(() => {
			launches += 1;
		}),
		{
			save: () => {
				saves += 1;
				return saves > 1
					? Promise.reject(new Error("保存失敗"))
					: Promise.resolve();
			},
		},
		() => "attempt",
	);
	await assert.rejects(controller.dispatch({ type: "run" }), /保存失敗/);
	await assert.rejects(controller.dispatch({ type: "run" }), /保存に失敗/);
	assert.equal(launches, 0);
});

void test("起動直後のキャンセルでは開始状態を保存しても Runtime を送信しない", async () => {
	let launches = 0;
	const dlc = await DlcController.open(
		plannedProject(),
		successfulRuntime(() => {
			launches += 1;
		}),
		{ save: () => Promise.resolve() },
		() => "attempt",
	);
	const run = dlc.dispatch({ type: "run" });
	await dlc.dispatch({ type: "cancel" });
	await run;
	assert.equal(launches, 0);
	assert.equal(dlc.projection().workItems[0]?.status, "cancelled");
});
