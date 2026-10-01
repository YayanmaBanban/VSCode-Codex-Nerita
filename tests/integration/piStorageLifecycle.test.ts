// 本番の会話処理と実 SDK を通し、保存先の衝突で会話や元ファイルを失わないことを守る。
import {
	cp,
	mkdir,
	readFile,
	readdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { piConversation } from "../fixtures/piConversation";
import type { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";

it("保存先の衝突を通知し、元データと会話を保持して修復後だけ再送する", async () => {
	const h = await piConversation();
	const { sdk, events, create } = h;
	const files = h;
	try {
		const controller = create();
		await controller.connect();
		expect(controller.snapshot().connection).toBe("ready");
		const original = controller.snapshot();
		await mkdir(join(files.cwd, ".pi"), { recursive: true });
		const occupied = join(files.cwd, ".pi/sessions");
		await writeFile(occupied, "keep original data");
		const before = await readdir(join(files.outside, "sessions"), {
			recursive: true,
		});
		h.configuration.storage = "workspace";
		await controller.receive({
			type: "prompt/send",
			requestId: "collision",
			sessionId: original.sessionId,
			text: "keep this draft",
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "request/failed",
				requestId: "collision",
			}),
		);
		expect(events).not.toContainEqual(
			expect.objectContaining({
				type: "prompt/accepted",
				requestId: "collision",
			}),
		);
		expect(controller.snapshot()).toMatchObject({
			connection: "ready",
			sessionId: original.sessionId,
			messages: original.messages,
			sessionPending: false,
		});
		expect(h.contexts.length).toBe(0);
		expect(await readFile(occupied, "utf8")).toBe("keep original data");
		expect(
			await readdir(join(files.outside, "sessions"), { recursive: true }),
		).toEqual(before);
		// 一時検証用の衝突を解消し、同じ本文を明示的に再送する。
		await unlink(occupied);
		await controller.receive({
			type: "prompt/send",
			requestId: "retry",
			sessionId: original.sessionId,
			text: "keep this draft",
		});
		await vi.waitFor(() =>
			expect(controller.snapshot().run).toBe("completed"),
		);
		expect(h.contexts.length).toBe(1);
		const savedId = controller.snapshot().sessionId;
		const rows = await sdk.SessionManager.listAll(occupied);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(savedId);
		await controller.dispose();
		const restarted = create();
		await restarted.connect();
		await restarted.receive({ type: "session/list", requestId: "list" });
		await restarted.receive({
			type: "session/load",
			requestId: "load",
			sessionId: savedId!,
		});
		expect(restarted.snapshot().messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ text: "keep this draft" }),
				expect.objectContaining({ text: "done" }),
			]),
		);
		expect(h.contexts.length).toBe(1);
		expect(
			await readdir(join(files.outside, "sessions"), { recursive: true }),
		).toEqual(before);
	} finally {
		await h.cleanup();
	}
});

/** モデルへ送る操作が、実 SDK の応答と保存まで完了したことを待つ。 */
async function send(controller: PiSessionController, text: string) {
	await controller.receive({
		type: "prompt/send",
		requestId: text,
		sessionId: controller.snapshot().sessionId,
		text,
	});
	await vi.waitFor(() => expect(controller.snapshot().run).toBe("completed"));
}

it("Forkを別ファイルへ保存し、移動後の再起動でも元会話と分岐の文脈を分離する", async () => {
	const h = await piConversation();
	h.configuration.storage = "workspace";
	try {
		const controller = h.create();
		await controller.connect();
		await send(controller, "original conversation");
		const originalId = controller.snapshot().sessionId!;
		await controller.receive({ type: "session/list", requestId: "list" });
		const directory = join(h.cwd, ".pi/sessions");
		const rows = await h.sdk.SessionManager.listAll(directory);
		expect(rows).toHaveLength(1);
		const originalPath = rows[0]!.path;
		const originalBytes = await readFile(originalPath, "utf8");
		await controller.receive({
			type: "session/fork",
			requestId: "fork",
			sessionId: originalId,
		});
		const forkId = controller.snapshot().sessionId!;
		expect(forkId).not.toBe(originalId);
		await send(controller, "fork only conversation");
		expect(h.contexts.at(-1)).toContain("original conversation");
		expect(await readFile(originalPath, "utf8")).toBe(originalBytes);
		await controller.dispose();
		const moved = join(h.root, "relocated workspace");
		await cp(h.cwd, moved, { recursive: true });
		await h.trustStore.setUserTrust(moved, true);
		h.configuration.cwd = moved;
		const reopened = h.create();
		await reopened.connect();
		await reopened.receive({ type: "session/list", requestId: "list" });
		await reopened.receive({
			type: "session/load",
			requestId: "fork-load",
			sessionId: forkId,
		});
		expect(reopened.snapshot().cwd).toBe(moved);
		expect(
			reopened.snapshot().messages.map((message) => message.text),
		).toContain("fork only conversation");
		expect(h.contexts).toHaveLength(2);
		await send(reopened, "continue fork");
		expect(h.contexts.at(-1)).toContain("fork only conversation");
		await reopened.receive({
			type: "session/load",
			requestId: "original-load",
			sessionId: originalId,
		});
		expect(
			reopened.snapshot().messages.map((message) => message.text),
		).not.toContain("fork only conversation");
		await send(reopened, "continue original");
		expect(h.contexts.at(-1)).toContain("original conversation");
		expect(h.contexts.at(-1)).not.toContain("fork only conversation");
		expect(await readFile(originalPath, "utf8")).toBe(originalBytes);
	} finally {
		await h.cleanup();
	}
});

it.each(["", "{broken session"])(
	"破損した保存履歴を初期化せず、現在の会話を継続できる: %j",
	async (broken) => {
		const h = await piConversation();
		h.configuration.storage = "workspace";
		try {
			const controller = h.create();
			await controller.connect();
			await send(controller, "saved target");
			const target = controller.snapshot().sessionId!;
			const rows = await h.sdk.SessionManager.listAll(
				join(h.cwd, ".pi/sessions"),
			);
			expect(rows).toHaveLength(1);
			await controller.receive({ type: "session/new", requestId: "new" });
			await send(controller, "current conversation");
			await controller.receive({
				type: "session/list",
				requestId: "list",
			});
			expect(
				controller.snapshot().sessions.map((row) => row.sessionId),
			).toContain(target);
			const current = controller.snapshot();
			await writeFile(rows[0]!.path, broken);
			await controller.receive({
				type: "session/load",
				requestId: "broken-load",
				sessionId: target,
			});
			expect(controller.snapshot()).toMatchObject({
				sessionId: current.sessionId,
				messages: current.messages,
				connection: "ready",
				sessionPending: false,
			});
			expect(controller.snapshot().sessionsError).toBeTruthy();
			expect(await readFile(rows[0]!.path, "utf8")).toBe(broken);
			expect(h.contexts).toHaveLength(2);
			await send(controller, "continue after failed restore");
			expect(h.contexts.at(-1)).toContain("current conversation");
			expect(h.contexts.at(-1)).not.toContain("saved target");
			expect(await readFile(rows[0]!.path, "utf8")).toBe(broken);
		} finally {
			await h.cleanup();
		}
	},
);
