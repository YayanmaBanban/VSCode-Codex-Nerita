// 待機列、背景実行の承認、取消し、履歴復元の境界を検証する。
import { expect, it, vi } from "vitest";
import { PiJobs } from "../../src/extension/backends/pi/PiJobs";
import { PiAgentViews } from "../../src/extension/backends/pi/PiAgentViews";
import { pending, piHarness } from "./piHarness";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createPiJobTool } from "../../src/extension/backends/pi/PiJobTool";

/** 表示 ID とジョブ ID は共通とし、保存はメモリー内で観測する。 */
function fixture() {
	const views = new PiAgentViews();
	views.parentId = "parent";
	const manager = { appendCustomEntry: vi.fn(() => "record") };
	const jobs = new PiJobs(views, manager);
	const add = () => ({
		id: views.start("call", "worker", "task", "."),
		parentId: "parent",
		status: "queued" as const,
		background: true,
		context: "fresh" as const,
	});
	return { views, manager, jobs, add };
}

it("4件の実行枠を超える子は待機し、取消し後に起動しない", async () => {
	const h = fixture();
	const release = pending<void>();
	const run = vi.fn(async () => {
		await release.promise;
		return "done";
	});
	const records = Array.from({ length: 5 }, h.add);
	const done = records.map((record) =>
		h.jobs.submit(record, new AbortController().signal, run),
	);
	await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4));
	expect(h.jobs.read(records[4]!.id).status).toBe("queued");
	await h.jobs.cancel(records[4]!.id);
	release.resolve();
	await Promise.allSettled(done);
	expect(run).toHaveBeenCalledTimes(4);
	expect(h.jobs.read(records[4]!.id).status).toBe("cancelled");
	expect(h.jobs.read(records[0]!.id).result).toBe('"done"');
});

it("全体停止は実行中と待機中を回収し、次の実行を受け付ける", async () => {
	const h = fixture();
	const done = Array.from({ length: 6 }, () =>
		h.jobs.submit(h.add(), new AbortController().signal, async (signal) => {
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), {
					once: true,
				}),
			);
			signal.throwIfAborted();
		}),
	);
	await vi.waitFor(() =>
		expect(
			h.jobs.list().filter((job) => job.status === "running"),
		).toHaveLength(4),
	);
	await h.jobs.stop();
	await Promise.allSettled(done);
	expect(h.jobs.list().every((job) => job.status === "cancelled")).toBe(true);
	await expect(
		h.jobs.submit(h.add(), new AbortController().signal, () =>
			Promise.resolve("next"),
		),
	).resolves.toBe("next");
});

it("承認待ちを表示し、親の応答終了後も既存の承認UIへ接続する", async () => {
	const h = piHarness();
	const views = new PiAgentViews();
	views.parentId = "pi-1";
	const jobs = new PiJobs(views);
	h.runtime.agentViews = views;
	h.runtime.jobs = jobs;
	await h.controller.connect();
	await h.send();
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	const id = views.start("call", "worker", "task", ".");
	const authorize = h.factory.mock.calls[0]![1];
	const done = jobs.submit(
		{
			id,
			parentId: "pi-1",
			status: "queued",
			background: true,
			context: "fresh",
		},
		new AbortController().signal,
		async (signal) => {
			await jobs.authorizer(id, authorize)({ title: "write" }, signal);
			return "approved";
		},
	);
	await vi.waitFor(() =>
		expect(h.controller.snapshot().permissions).toHaveLength(1),
	);
	expect(jobs.read(id).status).toBe("approval");
	expect(h.controller.snapshot().agents[0]?.statusMessage).toBe("承認待ち");
	const state = h.controller.snapshot();
	await h.controller.receive({
		type: "permission/respond",
		requestId: "approve-background",
		sessionId: "pi-1",
		runId: state.runId,
		permissionId: state.permissions[0]!.id,
		optionId: "accept",
	});
	await expect(done).resolves.toBe("approved");
	expect(h.controller.snapshot().permissions).toHaveLength(0);
	expect(h.controller.snapshot().agents[0]?.status).toBe("completed");
	await h.controller.dispose();
});

it("実行中の保存記録は中断として復元し、親IDを付け替える", () => {
	const h = fixture();
	const record = { ...h.add(), status: "approval" };
	const entries: SessionEntry[] = [
		{
			id: "entry",
			parentId: null,
			timestamp: new Date().toISOString(),
			type: "custom",
			customType: "nerita.job.v1",
			data: record,
		},
	];
	h.jobs.restore(entries, "forked-parent");
	expect(h.jobs.read(record.id)).toMatchObject({
		status: "interrupted",
		parentId: "forked-parent",
	});
	expect(() => h.jobs.read("another-session")).toThrow();
	expect(() =>
		h.jobs.restore(
			[
				{
					id: "broken",
					parentId: null,
					timestamp: "now",
					type: "custom",
					customType: "nerita.job.v1",
					data: {},
				},
			],
			"x",
		),
	).toThrow();
});

it("親完了後の停止操作でもジョブを回収する", async () => {
	const h = piHarness();
	const views = new PiAgentViews();
	const jobs = new PiJobs(views);
	h.runtime.agentViews = views;
	h.runtime.jobs = jobs;
	vi.mocked(h.runtime.abort).mockImplementation(() => jobs.stop());
	await h.controller.connect();
	await h.send();
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	const id = views.start("call", "worker", "task", ".");
	const done = jobs.submit(
		{
			id,
			parentId: "pi-1",
			status: "queued",
			context: "fresh",
			background: true,
		},
		new AbortController().signal,
		(signal) =>
			new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), {
					once: true,
				}),
			),
	);
	await vi.waitFor(() => expect(jobs.read(id).status).toBe("running"));
	await h.stop();
	await expect(done).rejects.toThrow();
	expect(jobs.read(id).status).toBe("cancelled");
	await h.controller.dispose();
});

it("管理ツールは結果取得と個別取消しだけを許可する", async () => {
	const h = fixture();
	const record = h.add();
	const done = h.jobs.submit(
		record,
		new AbortController().signal,
		(signal) =>
			new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), {
					once: true,
				}),
			),
	);
	await vi.waitFor(() =>
		expect(h.jobs.read(record.id).status).toBe("running"),
	);
	const tool = createPiJobTool(h.jobs);
	const execute = tool.execute.bind(tool);
	const rawContext: unknown = {};
	const context = rawContext as Parameters<typeof execute>[4];
	await execute(
		"call",
		{ action: "cancel", jobId: record.id },
		undefined,
		undefined,
		context,
	);
	await expect(done).rejects.toThrow();
	expect(
		(
			await execute(
				"read",
				{ action: "read", jobId: record.id },
				undefined,
				undefined,
				context,
			)
		).details,
	).toMatchObject({ status: "cancelled" });
	await expect(
		execute(
			"unknown",
			{ action: "read", jobId: "another-session" },
			undefined,
			undefined,
			context,
		),
	).rejects.toThrow();
});
