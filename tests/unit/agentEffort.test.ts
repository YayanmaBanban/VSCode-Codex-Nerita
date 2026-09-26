// モデルの対応値と未確認値の保持を、保存画面と Host 共通の規則で検証する。
import { describe, it, expect } from "vitest";
import {
	effortError,
	effortOptions,
	handoffEffortError,
} from "../../src/shared/agentManager/effort";
import { defaultHandoff } from "../../src/shared/agentManager/config";

describe("model effort validation", () => {
	const models = [
		{ value: "a", name: "A", efforts: ["low", "high"] },
		{ value: "b", name: "B", efforts: ["low"] },
		{ value: "plain", name: "Plain", efforts: [] },
	];
	it("requires reselection after changing to an incompatible model", () => {
		expect(effortOptions(models, "b")).toEqual(["low"]);
		expect(effortError(models, "b", "high", "a", "high")).toContain(
			"非対応",
		);
		expect(effortError(models, "b", "low", "a", "high")).toBeUndefined();
		expect(effortError(models, "plain", "low")).toContain("非対応");
	});
	it("keeps unchanged offline values but disallows new unverified combinations", () => {
		expect(effortError([], "a", "high", "a", "high")).toBeUndefined();
		expect(effortError([], "b", "high", "a", "high")).toContain(
			"確認できません",
		);
		expect(effortError(models, undefined, "high")).toContain(
			"確認できません",
		);
		expect(effortError([], "a", undefined, "a", "high")).toBeUndefined();
	});
	it("defers current handoff validation until its model is known", () => {
		const config = defaultHandoff();
		config.backends.pi = { strategy: "current", thinking: "high" };
		expect(
			handoffEffortError(config, defaultHandoff(), { pi: [], codex: [] }),
		).toBeUndefined();
	});
});
