// 通信境界の要求とスナップショットの実行時検証を確認する。
import { describe, expect, it } from "vitest";
import { initialState } from "../../src/shared/chatState";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
describe("通信境界", () => {
	it("実行可能な要求だけ受理する", () => {
		for (const value of [
			null,
			[],
			{ type: "shell/execute", command: "bad" },
			{ type: "prompt/send", requestId: "a", sessionId: "s", text: " " },
			{
				type: "prompt/send",
				requestId: "a",
				sessionId: "s",
				text: "x".repeat(100001),
			},
		]) {
			expect(isUiMessage(value)).toBe(false);
		}
		expect(
			isUiMessage({
				type: "prompt/send",
				requestId: "a",
				sessionId: "s",
				text: "こんにちは",
			}),
		).toBe(true);
	});
	it("壊れたスナップショットと差分を拒否する", () => {
		expect(
			isHostMessage({ type: "state/snapshot", state: initialState() }),
		).toBe(true);
		expect(
			isHostMessage({ type: "state/patch", revision: -1, patch: {} }),
		).toBe(false);
		expect(
			isHostMessage({
				type: "state/patch",
				revision: 1,
				patch: {
					permissions: [{ id: "p", title: "t", options: [null] }],
				},
			}),
		).toBe(false);
		expect(
			isHostMessage({
				type: "state/patch",
				revision: 1,
				patch: { arbitrary: true },
			}),
		).toBe(false);
	});
});
