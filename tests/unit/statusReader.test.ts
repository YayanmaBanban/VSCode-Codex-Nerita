// 内部取得の通知分離・排他・解析失敗を検証する。
import { expect, it, vi } from "vitest";
import {
	StatusReader,
	parseStatus,
} from "../../src/extension/acp/statusReader";
import { deferred, fixture } from "./fakeTransport";

const statusText =
	"**Model:** gpt-6-astra\n**codex 5h limit:** 60% left (resets 18:00)\n**codex Weekly limit:** 0% left";

it("残率・複数枠・0%を解析し、未知形式や範囲外は失敗する", () => {
	expect(parseStatus(statusText)).toEqual([
		{ label: "codex 5h limit", remaining: 60, detail: "(resets 18:00)" },
		{ label: "codex Weekly limit", remaining: 0, detail: "" },
	]);
	for (const text of [
		"**Limits:** data not available yet",
		"**codex Limit:** 101% left",
		"private account info",
	]) {
		expect(() => parseStatus(text)).toThrow();
	}
});

it("内部文章を収集し、通常送信を取得完了まで待機させる", async () => {
	const reader = new StatusReader();
	const pending = deferred<unknown>();
	const log = vi.fn();
	const result = reader.read("s", () => pending.promise, log);
	await Promise.resolve();
	const send = vi.fn(() => Promise.resolve("answer"));
	const next = reader.serial(send);
	for (const text of [statusText.slice(0, 30), statusText.slice(30)]) {
		expect(
			reader.consume({
				sessionId: "s",
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text },
				},
			}),
		).toBe(true);
	}
	expect(
		reader.consume({
			sessionId: "s",
			update: { sessionUpdate: "usage_update", used: 4, size: 100 },
		}),
	).toBe(false);
	expect(send).not.toHaveBeenCalled();
	pending.resolve({});
	expect(await result).toHaveLength(2);
	expect(await next).toBe("answer");
	expect(log).not.toHaveBeenCalled();
	expect(
		reader.consume({
			sessionId: "s",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "answer" },
			},
		}),
	).toBe(false);
});

it("取得失敗はnullと分類ログを返し、個人情報をログへ出さない", async () => {
	const reader = new StatusReader();
	const log = vi.fn();
	expect(
		await reader.read(
			"s",
			() => Promise.reject(new Error("secret@email")),
			log,
		),
	).toBeNull();
	expect(await reader.read("s", async () => {}, log)).toBeNull();
	expect(log.mock.calls.flat().join(" ")).not.toContain("secret@email");
	expect(log).toHaveBeenCalledTimes(2);
});

it("接続と回答後に取得し、失敗と再接続では古い残率を表示しない", async () => {
	const { controller, connections } = fixture();
	await controller.connect();
	const first = connections[0]!;
	expect(first.transport.readStatus).toHaveBeenCalledOnce();
	vi.mocked(first.transport.readStatus).mockResolvedValue(
		parseStatus(statusText),
	);
	const send = controller.receive({
		type: "prompt/send",
		requestId: "p",
		sessionId: controller.snapshot().sessionId!,
		text: "hello",
	});
	first.result.resolve({ stopReason: "end_turn" });
	await send;
	await vi.waitFor(() => expect(controller.snapshot().quota).toHaveLength(2));
	vi.mocked(first.transport.readStatus).mockResolvedValue(null);
	await controller.receive({
		type: "prompt/send",
		requestId: "p2",
		sessionId: controller.snapshot().sessionId!,
		text: "again",
	});
	await vi.waitFor(() => expect(controller.snapshot().quota).toBeNull());
	const stale = deferred<ReturnType<typeof parseStatus> | null>();
	vi.mocked(first.transport.readStatus).mockReturnValue(stale.promise);
	await controller.receive({
		type: "prompt/send",
		requestId: "p3",
		sessionId: controller.snapshot().sessionId!,
		text: "last",
	});
	expect(controller.snapshot().messages).toEqual([
		expect.objectContaining({ text: "hello" }),
		expect.objectContaining({ text: "again" }),
		expect.objectContaining({ text: "last" }),
	]);
	await controller.connect();
	stale.resolve(parseStatus(statusText));
	await Promise.resolve();
	expect(controller.snapshot().quota).toBeNull();
	await controller.dispose();
});
