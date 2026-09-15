// 実プロセスを通じて一覧・再開・フォーク・アーカイブの ACP 要求を確認する。
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, it } from "vitest";
import { createTransport } from "../../src/extension/acp/transport";
import { SessionController } from "../../src/extension/session/sessionController";

it("ACP の標準メソッドで履歴を管理し、応答前の通知を復元する", async () => {
	const cwd = path.resolve("dist", "session transport", randomUUID());
	await mkdir(cwd, { recursive: true });
	const controller = new SessionController((callbacks) =>
		createTransport(
			process.execPath,
			path.resolve("tests/fixtures/session-history-agent.mjs"),
			cwd,
			callbacks,
			() => undefined,
		),
	);
	try {
		await controller.connect();
		expect(controller.snapshot().sessions).toHaveLength(2);
		await controller.receive({
			type: "session/load",
			requestId: "load",
			sessionId: "saved",
		});
		expect(controller.snapshot().messages.map((item) => item.text)).toEqual(
			["以前の質問", "以前の回答"],
		);
		await controller.receive({
			type: "session/fork",
			requestId: "fork",
			sessionId: "saved",
		});
		expect(controller.snapshot().sessionId).toBe("created-2");
		expect(controller.snapshot().messages).toHaveLength(2);
		await controller.receive({
			type: "session/delete",
			requestId: "archive",
			sessionId: "saved",
		});
		expect(
			controller
				.snapshot()
				.sessions.some((item) => item.sessionId === "saved"),
		).toBe(false);
		await controller.receive({ type: "session/new", requestId: "new" });
		expect(controller.snapshot().messages).toEqual([]);
		const requests = (
			await readFile(path.join(cwd, "requests.jsonl"), "utf8")
		)
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as {
						method: string;
						params: Record<string, unknown>;
					},
			);
		for (const request of requests.filter((item) =>
			["session/list", "session/load", "session/fork"].includes(
				item.method,
			),
		)) {
			expect(request.params.cwd).toBe(cwd);
		}
		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "session/delete",
				params: { sessionId: "saved" },
			}),
		);
		expect(
			requests.filter((item) => item.method === "session/list").length,
		).toBeGreaterThanOrEqual(8);
	} finally {
		await controller.dispose();
	}
}, 15000);
