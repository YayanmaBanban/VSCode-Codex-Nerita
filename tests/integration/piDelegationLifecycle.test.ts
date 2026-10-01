// 子の実ファイル変更から保存・別接続での復元までと、遅い承認後の非実行を検証する。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { piDelegation } from "../fixtures/piDelegation";
import { verifyPiAgentPersistence } from "../fixtures/piAgentPersistence";
import { pending } from "../unit/piHarness";

it("子の実結果と親子関係を保存し、復元とForkで再実行しない", async () => {
	const h = await piDelegation();
	try {
		h.setTool("subagent", {
			agent: "worker",
			task: "write child result",
			context: "fresh",
			async: false,
		});
		h.setChildTool("write", { path: "child.txt", content: "child result" });
		const parent = await h.open();
		await parent.prompt("delegate fixture");
		expect(await readFile(join(h.cwd, "child.txt"), "utf8")).toBe(
			"child result",
		);
		const cards = parent.agentViews!.list();
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({ status: "completed" });
		const view = parent.agentViews!.read(cards[0]!.threadId);
		expect(view.parentThreadId).toBe(parent.sessionId);
		expect(
			view.messages.some((message) => message.text === "finished"),
		).toBe(true);
		expect(view.tools).toHaveLength(1);
		expect(view.tools[0]).toMatchObject({ status: "completed" });
		const requests = h.requests.length;
		await verifyPiAgentPersistence(parent, h.options);
		expect(h.requests).toHaveLength(requests);
		expect(await readFile(join(h.cwd, "child.txt"), "utf8")).toBe(
			"child result",
		);
	} finally {
		await h.cleanup();
	}
});

it.each(["stop", "trust"] as const)(
	"子の書込み承認待ちの%s後に遅い許可を返してもファイルを変更しない",
	async (action) => {
		const h = await piDelegation();
		const gate = pending<AbortSignal>();
		let approvals = 0;
		try {
			h.setTool("subagent", {
				agent: "worker",
				task: "write after approval",
				async: true,
			});
			h.setChildTool("write", {
				path: "after-stop.txt",
				content: "unexpected",
			});
			const parent = await h.open({
				authorize: (_presentation, signal) =>
					++approvals === 1 ? Promise.resolve(signal!) : gate.promise,
			});
			await parent.prompt("delegate fixture");
			await vi.waitFor(() => expect(approvals).toBe(2));
			expect(parent.jobs!.list()[0]?.status).toBe("approval");
			await expect(
				readFile(join(h.cwd, "after-stop.txt")),
			).rejects.toMatchObject({ code: "ENOENT" });
			const stopping =
				action === "stop"
					? parent.abort()
					: h.trustStore.setUserTrust(h.cwd, false);
			gate.resolve(new AbortController().signal);
			await stopping;
			await vi.waitFor(() =>
				expect(parent.jobs!.list()[0]?.status).toBe("cancelled"),
			);
			await expect(
				readFile(join(h.cwd, "after-stop.txt")),
			).rejects.toMatchObject({ code: "ENOENT" });
			const requests = h.requests.length;
			await parent.close();
			const target = parent.history!.target(parent.sessionId);
			await h.trustStore.setUserTrust(h.cwd, true);
			const resumed = await h.open({
				resume: target,
				authorize: () => {
					throw new Error("復元時に承認を要求しました。");
				},
			});
			expect(resumed.jobs!.list()).toEqual(parent.jobs!.list());
			expect(h.requests).toHaveLength(requests);
		} finally {
			gate.resolve(new AbortController().signal);
			await h.cleanup();
		}
	},
);
