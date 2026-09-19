// MCPコマンドの検証・ページ取得と、接続変更時の古い応答の破棄を確認する。
import { expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: {}, window: {} }));
import { responseParsers } from "../../src/extension/codex/protocol/responses";
import { codexHarness, deferred } from "./codexHarness";
import { mcpStatusFixture } from "../fixtures/mcpStatusFixture";
import type { McpServerSummary } from "../../src/shared/mcp";
import { isHostMessage } from "../../src/shared/hostMessageValidation";

it("名前と接続状態だけを検証・抽出する", () => {
	const page = { data: [mcpStatusFixture], nextCursor: null };
	const parse = responseParsers["mcpServerStatus/list"];
	expect(parse(page)).toEqual({
		data: [{ name: "workspace", runtimeStatus: "connected" }],
		nextCursor: null,
	});
	for (const value of [
		null,
		{},
		{ ...page, nextCursor: 5 },
		{ data: [{}], nextCursor: null },
		{ ...page, data: [{ ...mcpStatusFixture, runtimeStatus: 5 }] },
	]) {
		expect(() => parse(value)).toThrow();
	}
});

it("/mcpは全ページをメッセージへ表示し、モデルを実行しない", async () => {
	const h = codexHarness();
	h.client.listMcpServerStatus
		.mockResolvedValueOnce({ data: [mcpStatusFixture], nextCursor: "next" })
		.mockResolvedValueOnce({
			data: [{ ...mcpStatusFixture, name: "second" }],
			nextCursor: null,
		});
	try {
		await h.session.connect();
		const id = h.session.snapshot().sessionId;
		const listener = vi.fn();
		h.session.subscribe(listener);
		await h.send(" /mcp ");
		expect(h.client.listMcpServerStatus.mock.calls).toEqual([
			[id, undefined],
			[id, "next"],
		]);
		const state = h.session.snapshot();
		expect(state.messages[0]?.text).toBe("/mcp");
		expect(state.messages[1]?.text).toBe(
			"設定済みMCPサーバー:\n● workspace (connected)\n● second (connected)",
		);
		expect(state.messages[1]?.mcp?.status).toBe("ready");
		expect(
			isHostMessage({
				type: "state/patch",
				revision: state.revision,
				patch: { messages: state.messages },
			}),
		).toBe(true);
		expect(state.run).toBe("idle");
		expect(h.client.startTurn).not.toHaveBeenCalled();
		expect(h.client.steerTurn).not.toHaveBeenCalled();
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ type: "prompt/accepted" }),
		);
	} finally {
		await h.session.dispose();
	}
});

it("取得失敗を通知してロックを解除し、空の一覧も表示できる", async () => {
	const h = codexHarness();
	h.client.listMcpServerStatus.mockRejectedValueOnce(
		new Error("unavailable"),
	);
	try {
		await h.session.connect();
		const listener = vi.fn();
		h.session.subscribe(listener);
		await h.send("/mcp");
		expect(h.session.snapshot().messages[1]?.mcp).toEqual({
			status: "error",
		});
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ type: "request/failed" }),
		);
		await h.send("/mcp");
		expect(h.session.snapshot().messages[3]?.text).toBe(
			"設定済みMCPサーバー:\nMCPサーバーはありません。",
		);
	} finally {
		await h.session.dispose();
	}
});

it("切断後に届いた一覧を新しい接続の会話に混ぜない", async () => {
	const h = codexHarness();
	const result = deferred<{
		data: McpServerSummary[];
		nextCursor: null;
	}>();
	h.client.listMcpServerStatus.mockReturnValueOnce(result.promise);
	try {
		await h.session.connect();
		const request = h.send("/mcp");
		h.connections.at(-1)!.callbacks.disconnected?.(new Error("closed"));
		await h.session.connect();
		result.resolve({ data: [mcpStatusFixture], nextCursor: null });
		await request;
		expect(h.session.snapshot().messages).toEqual([]);
	} finally {
		await h.session.dispose();
	}
});

it("待機中はインジケータを配信し、完了時は同じメッセージを置き換える", async () => {
	const h = codexHarness();
	const result = deferred<{ data: McpServerSummary[]; nextCursor: null }>();
	h.client.listMcpServerStatus.mockReturnValueOnce(result.promise);
	try {
		await h.session.connect();
		const request = h.send("/mcp");
		const pending = h.session.snapshot();
		expect(pending.messages[1]?.mcp).toEqual({ status: "loading" });
		expect(
			isHostMessage({
				type: "state/patch",
				revision: pending.revision,
				patch: { messages: pending.messages },
			}),
		).toBe(true);
		await h.send("/mcp");
		expect(h.client.listMcpServerStatus).toHaveBeenCalledTimes(1);
		result.resolve({
			data: [{ name: "disabled-tool", runtimeStatus: "disabled" }],
			nextCursor: null,
		});
		await request;
		const completed = h.session.snapshot();
		expect(completed.messages).toHaveLength(2);
		expect(completed.messages[1]?.id).toBe(pending.messages[1]?.id);
		expect(completed.messages[1]?.mcp).toEqual({
			status: "ready",
			servers: [{ name: "disabled-tool", runtimeStatus: "disabled" }],
		});
		const invalid = structuredClone(completed) as unknown as {
			messages: { mcp?: unknown }[];
		};
		invalid.messages[1]!.mcp = {
			status: "ready",
			servers: [{ name: "broken", runtimeStatus: 3 }],
		};
		expect(
			isHostMessage({
				type: "state/patch",
				revision: completed.revision,
				patch: invalid,
			}),
		).toBe(false);
	} finally {
		await h.session.dispose();
	}
});
