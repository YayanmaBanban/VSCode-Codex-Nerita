// 項目完了と未知のツールデータを、表示への変換で失わないことを確認する。
import { expect, it } from "vitest";
import { initialState } from "../../src/shared/chatState";
import { itemPatch, messagePatch } from "../../src/extension/codex/items/chatItems";

it("本文の完了はTurnの実行中にも反映される", () => {
	const state = { ...initialState(), runId: "turn", run: "running" as const };
	Object.assign(state, messagePatch(state, "answer", "途中", true));
	expect(state.messages[0]?.streaming).toBe(true);
	Object.assign(
		state,
		itemPatch(
			state,
			{ id: "answer", type: "agentMessage", text: "完成" },
			true,
		),
	);
	expect(state.run).toBe("running");
	expect(state.messages[0]).toMatchObject({ text: "完成", streaming: false });
});

it("未対応の種類と既知の汎用ツールの元データを丸ごと保持する", () => {
	for (const type of ["futureTool", "mcpToolCall"]) {
		const value = {
			id: "tool",
			type,
			server: "server",
			tool: "read",
			arguments: { path: "a" },
			result: { data: [1, null, false] },
			extra: { unknown: "保持" },
		};
		const patch = itemPatch(
			{ ...initialState(), runId: "turn" },
			value,
			true,
		);
		expect(patch.tools?.[0]?.rawItem).toEqual(value);
	}
});
