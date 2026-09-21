// Piのツール通知を実Controllerへ流し、順序・部分結果・停止・別ターンを検証する。
import { afterEach, expect, it, vi } from "vitest";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import type { PiSessionController } from "../../src/extension/backends/pi/PiSessionController";
import { assistant, pending, piHarness } from "./piHarness";

const controllers: PiSessionController[] = [];
afterEach(async () => {
	await Promise.all(
		controllers.splice(0).map((controller) => controller.dispose()),
	);
});

/** 実行開始からすべての通知をWebviewと同じvalidatorへ通す。 */
async function connected() {
	const h = piHarness();
	controllers.push(h.controller);
	h.controller.subscribe((event) => expect(isHostMessage(event)).toBe(true));
	await h.controller.connect();
	await h.send();
	return h;
}

/** SDKの累積テキスト結果を作る。 */
const result = (text: string) => ({
	content: [{ type: "text", text }],
	details: {},
});

it("並列read/lsを開始順に保ち、部分結果を置換して本文の間へ表示する", async () => {
	const h = await connected();
	h.emit({ type: "message_end", message: assistant("確認します") });
	h.emit({
		type: "tool_execution_start",
		toolCallId: "read-1",
		toolName: "read",
		args: { path: "a.txt", offset: 2, limit: 3 },
	});
	h.emit({
		type: "tool_execution_start",
		toolCallId: "ls-1",
		toolName: "ls",
		args: {},
	});
	const order = h.controller.snapshot().tools[0]?.order;
	for (const text of ["a", "abc"]) {
		h.emit({
			type: "tool_execution_update",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "a.txt", offset: 2, limit: 3 },
			partialResult: result(text),
		});
	}
	expect(h.controller.snapshot().tools[0]).toMatchObject({
		status: "in_progress",
		content: [{ content: { text: "abc" } }],
		order,
	});
	h.emit({
		type: "tool_execution_end",
		toolCallId: "ls-1",
		toolName: "ls",
		result: result("a.txt"),
		isError: false,
	});
	h.emit({
		type: "tool_execution_end",
		toolCallId: "read-1",
		toolName: "read",
		result: result("abcd"),
		isError: false,
	});
	// 終了後の重複通知・部分通知でカードを実行中へ戻さない。
	h.emit({
		type: "tool_execution_start",
		toolCallId: "read-1",
		toolName: "read",
		args: { path: "wrong.txt" },
	});
	h.emit({
		type: "tool_execution_update",
		toolCallId: "read-1",
		toolName: "read",
		args: {},
		partialResult: result("old"),
	});
	h.emit({ type: "message_end", message: assistant("確認しました") });
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	const state = h.controller.snapshot();
	expect(state.tools).toMatchObject([
		{
			id: "read-1",
			kind: "read",
			paths: ["a.txt"],
			status: "completed",
			rawInput: { offset: 2, limit: 3 },
			content: [{ content: { text: "abcd" } }],
			order,
		},
		{ id: "ls-1", kind: "list", paths: ["."], status: "completed" },
	]);
	const timeline = [...state.messages, ...state.tools].sort(
		(a, b) => a.order! - b.order!,
	);
	expect(
		timeline.map((item) => ("text" in item ? item.text : item.id)),
	).toEqual(["hello", "確認します", "read-1", "ls-1", "確認しました"]);
});

it("ツール失敗を表示し、同じtoolCallIdを使う継続会話でも過去の結果を保持する", async () => {
	const h = await connected();
	h.emit({
		type: "tool_execution_start",
		toolCallId: "reused",
		toolName: "read",
		args: { path: "missing" },
	});
	h.emit({
		type: "tool_execution_end",
		toolCallId: "reused",
		toolName: "read",
		result: result("ENOENT"),
		isError: true,
	});
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	const previous = h.controller.snapshot().tools[0];
	await h.send("retry");
	h.emit({
		type: "tool_execution_start",
		toolCallId: "reused",
		toolName: "read",
		args: { path: "exists" },
	});
	h.emit({
		type: "tool_execution_end",
		toolCallId: "reused",
		toolName: "read",
		result: result("ok"),
		isError: false,
	});
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	expect(h.controller.snapshot().tools[0]).toEqual(previous);
	expect(h.controller.snapshot().tools.map((tool) => tool.status)).toEqual([
		"failed",
		"completed",
	]);
});

it("Stopは進行中だけを停止し、失敗通知と終了通知の欠落の両方を扱う", async () => {
	const h = await connected();
	for (const id of ["done", "aborted", "no-end"]) {
		h.emit({
			type: "tool_execution_start",
			toolCallId: id,
			toolName: "read",
			args: { path: id },
		});
	}
	h.emit({
		type: "tool_execution_end",
		toolCallId: "done",
		toolName: "read",
		result: result("ok"),
		isError: false,
	});
	const abort = pending<void>();
	vi.mocked(h.runtime.abort).mockImplementationOnce(() => abort.promise);
	await h.stop();
	h.emit({
		type: "tool_execution_end",
		toolCallId: "aborted",
		toolName: "read",
		result: result("aborted"),
		isError: true,
	});
	abort.resolve();
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("cancelled"),
	);
	expect(h.controller.snapshot().tools.map((tool) => tool.status)).toEqual([
		"completed",
		"cancelled",
		"cancelled",
	]);
	h.emit({
		type: "tool_execution_end",
		toolCallId: "no-end",
		toolName: "read",
		result: result("late"),
		isError: false,
	});
	expect(h.controller.snapshot().tools[2]?.status).toBe("cancelled");
	await h.controller.receive({ type: "session/new", requestId: "new" });
	expect(h.controller.snapshot().tools).toEqual([]);
});

it("モデル障害で残る実行中カードを失敗にし、画像データを本文へ混入させない", async () => {
	const h = await connected();
	h.emit({
		type: "tool_execution_start",
		toolCallId: "image",
		toolName: "read",
		args: { path: "image.png" },
	});
	h.emit({
		type: "tool_execution_end",
		toolCallId: "image",
		toolName: "read",
		isError: false,
		result: {
			content: [
				{
					type: "image",
					mimeType: "image/png",
					data: "private-base64",
				},
			],
		},
	});
	h.emit({
		type: "tool_execution_start",
		toolCallId: "unfinished",
		toolName: "ls",
		args: {},
	});
	h.emit({
		type: "message_end",
		message: { ...assistant("", "error"), errorMessage: "connection lost" },
	});
	h.complete();
	await vi.waitFor(() => expect(h.controller.snapshot().run).toBe("failed"));
	expect(h.controller.snapshot().tools[1]).toMatchObject({
		status: "failed",
		content: [{ content: { text: "connection lost" } }],
	});
	expect(JSON.stringify(h.controller.snapshot().tools[0])).not.toContain(
		"private-base64",
	);
	expect(h.controller.snapshot().tools[0]?.content).toMatchObject([
		{ content: { text: "画像を読み取りました。" } },
	]);
});
