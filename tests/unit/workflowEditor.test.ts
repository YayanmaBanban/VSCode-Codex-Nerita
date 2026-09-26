// グラフ編集で参照を失わず、循環や危険な削除を拒否することを確認する。
import { expect, it } from "vitest";
import { validateWorkflow } from "../../src/shared/workflows/definition";
import {
	connectSteps,
	removeStep,
	renameStep,
} from "../../src/webview/pi/workflows/workflowModel";
import { workflowRequestSchema } from "../../src/shared/workflows/messages";

/** 継続と結果参照を含む最小の定義。 */
function fixture() {
	return validateWorkflow({
		version: 1,
		name: "test",
		outputs: ["b"],
		steps: [
			{ id: "a", agent: "worker", task: "start" },
			{ id: "b", resume: "a", task: "{{ a.output }}", depends_on: ["a"] },
		],
	});
}
it("ID 変更で会話・結果・依存先をまとめて更新する", () => {
	const renamed = renameStep(fixture(), "a", "start");
	expect(renamed.steps[1]).toMatchObject({
		resume: "start",
		task: "{{ start.output }}",
		depends_on: ["start"],
	});
	expect(() => validateWorkflow(renamed)).not.toThrow();
	expect(() => renameStep(renamed, "start", "b")).toThrow();
});
it("自己接続・循環接続・参照中のステップ削除を拒否する", () => {
	const workflow = fixture();
	expect(() => connectSteps(workflow, "b", "a")).toThrow("循環");
	expect(() => connectSteps(workflow, "a", "a")).toThrow();
	expect(() => removeStep(workflow, "a")).toThrow("参照");
	expect(connectSteps(workflow, "a", "b").steps[1]?.depends_on).toEqual([
		"a",
	]);
});
it("UI から実行先や任意コードを指定できない", () => {
	expect(
		workflowRequestSchema.safeParse({
			type: "run",
			version: 1,
			id: 1,
			file: "../other.toml",
		}).success,
	).toBe(false);
	expect(
		workflowRequestSchema.safeParse({
			type: "run",
			version: 1,
			id: 1,
			script: "run()",
		}).success,
	).toBe(false);
});
