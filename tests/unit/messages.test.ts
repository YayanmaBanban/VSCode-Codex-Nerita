// 通信境界の実行時検証と部分的なツール通知の保持を検証する。
import { describe, expect, it } from "vitest";
import { initialState } from "../../src/shared/messages";
import { isHostMessage, isUiMessage } from "../../src/shared/validation";
import { updateState } from "../../src/extension/session/updates";
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
	it("Guardian の完了通知で入力を保持し、出力を更新する", () => {
		const state = {
			...initialState(),
			sessionId: "s",
			runId: "r",
			run: "running" as const,
		};
		Object.assign(
			state,
			updateState(state, {
				sessionId: "s",
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "guardian",
					title: "Guardian Review",
					rawInput: { action: { command: "pnpm --version" } },
				},
			}),
		);
		Object.assign(
			state,
			updateState(state, {
				sessionId: "s",
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "guardian",
					status: "completed",
					rawOutput: { review: { status: "approved" } },
				},
			}),
		);
		expect(state.tools[0]).toMatchObject({
			title: "Guardian Review",
			status: "completed",
			rawInput: { action: { command: "pnpm --version" } },
			rawOutput: { review: { status: "approved" } },
		});
		expect(isHostMessage({ type: "state/snapshot", state })).toBe(true);
		const patch = updateState(state, {
			sessionId: "s",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "guardian",
				content: [],
				rawOutput: null,
			},
		});
		expect(patch.tools?.[0]).toMatchObject({
			content: [],
			rawOutput: null,
		});
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
	it("ツールの状態更新でタイトル・変更ファイルを維持する", () => {
		const state = {
			...initialState(),
			sessionId: "s",
			runId: "r",
			run: "running" as const,
		};
		Object.assign(
			state,
			updateState(state, {
				sessionId: "s",
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t",
					title: "変更",
					content: [
						{
							type: "diff",
							path: "a.ts",
							oldText: "",
							newText: "new",
						},
					],
				},
			}),
		);
		const patch = updateState(state, {
			sessionId: "s",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "t",
				status: "completed",
			},
		});
		expect(patch.tools?.[0]).toEqual({
			id: "t",
			title: "変更",
			status: "completed",
			paths: ["a.ts"],
			content: [
				{ type: "diff", path: "a.ts", oldText: "", newText: "new" },
			],
		});
	});
});
