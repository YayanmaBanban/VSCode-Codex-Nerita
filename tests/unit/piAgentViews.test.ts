// Pi の子の会話取得を Controller 経由で検証し、別会話からの参照を拒否する。
import { expect, it } from "vitest";
import { PiAgentViews } from "../../src/extension/backends/pi/PiAgentViews";
import { assistant, piHarness } from "./piHarness";

it("実行中の子をカードへ通知し、終了後もViewer用に本文を返す", async () => {
	const h = piHarness();
	const views = new PiAgentViews();
	views.parentId = h.runtime.sessionId;
	h.runtime.agentViews = views;
	await h.controller.connect();
	await h.send();
	const id = views.start("delegate", "reviewer", "review", ".");
	views.status(id, "running");
	views.event(id, {
		type: "message_end",
		message: assistant("child output"),
	});
	expect(h.controller.snapshot().agents[0]).toMatchObject({
		threadId: id,
		status: "running",
	});
	views.status(id, "completed");
	await h.controller.receive({
		type: "agent/read",
		requestId: "view",
		sessionId: "pi-1",
		threadId: id,
	});
	const response = h.events.find((event) => event.type === "agent/view");
	expect(response).toMatchObject({
		view: {
			threadId: id,
			parentThreadId: "pi-1",
			messages: [{ text: "review" }, { text: "child output" }],
		},
	});
	expect(
		h.controller
			.snapshot()
			.messages.some((message) => message.text === "child output"),
	).toBe(false);
	await h.controller.receive({
		type: "agent/read",
		requestId: "stale",
		sessionId: "old",
		threadId: id,
	});
	await h.controller.receive({
		type: "agent/read",
		requestId: "unknown",
		sessionId: "pi-1",
		threadId: "unknown",
	});
	expect(
		h.events
			.filter((event) => event.type === "request/failed")
			.map((event) => event.requestId),
	).toEqual(["stale", "unknown"]);
	await h.controller.dispose();
});

it("会話取得で返した配列の変更は記録へ影響しない", () => {
	const views = new PiAgentViews();
	const id = views.start("task", "worker", "original", ".");
	views.read(id).messages[0]!.text = "modified";
	expect(views.read(id).messages[0]!.text).toBe("original");
});
