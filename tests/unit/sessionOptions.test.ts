// 設定の初期値・更新・世代境界と、添付の送信経路を検証する。
import { afterEach, expect, it, vi } from "vitest";
import { fixture, deferred } from "./fakeTransport";
import { settingsFixture } from "../../src/webview/chat/settingsFixture";
import type { SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk";

const fixtures: ReturnType<typeof fixture>[] = [];
/** サーバー提供の設定と現在 ID を含むセッションを作る。 */
async function setup() {
	const session = {
		sessionId: "settings",
		models: { currentModelId: "gpt-5.6-luna[high]" },
		modes: { currentModeId: "read-only", availableModes: [] },
		configOptions: settingsFixture().map((option) => ({
			...option,
			type: "select" as const,
		})),
	};
	const files = {
		pick: vi.fn(() =>
			Promise.resolve([
				{
					id: "file",
					name: "code.ts",
					uri: "file:///workspace/code.ts",
				},
			]),
		),
		open: vi.fn(() => Promise.resolve()),
	};
	const f = fixture({ session, files });
	fixtures.push(f);
	await f.controller.connect();
	return { ...f, files, session };
}
afterEach(async () => {
	for (const f of fixtures.splice(0)) {
		await f.controller.dispose();
	}
});

it("現在 ID を優先し、設定変更の応答で全候補を更新する", async () => {
	const { controller, connections, session } = await setup();
	const values = Object.fromEntries(
		controller.snapshot().configOptions.map((o) => [o.id, o.currentValue]),
	);
	expect(values).toMatchObject({
		model: "gpt-5.6-luna",
		reasoning_effort: "high",
		mode: "read-only",
	});
	const transport = connections[0]!.transport;
	const request = {
		type: "config/set",
		requestId: "config",
		sessionId: "settings",
		configId: "model",
		value: "gpt-6-astra",
	};
	await controller.receive({
		...request,
		requestId: "bad",
		value: "unknown",
	});
	expect(transport.setConfig).not.toHaveBeenCalled();
	const response = deferred<SetSessionConfigOptionResponse>();
	vi.mocked(transport.setConfig).mockReturnValueOnce(response.promise);
	const changing = controller.receive(request);
	expect(controller.snapshot().configPending).toBe(true);
	await controller.receive({ ...request, requestId: "concurrent" });
	expect(transport.setConfig).toHaveBeenCalledExactlyOnceWith(
		"settings",
		"model",
		"gpt-6-astra",
	);
	response.resolve({ configOptions: session.configOptions.slice(0, 3) });
	await changing;
	expect(controller.snapshot().configOptions).toHaveLength(3);
	expect(controller.snapshot().configPending).toBe(false);
	vi.mocked(transport.setConfig).mockRejectedValueOnce(new Error("rejected"));
	await controller.receive({ ...request, requestId: "rejected" });
	expect(controller.snapshot().configPending).toBe(false);
	expect(controller.snapshot().configOptions[2]?.currentValue).toBe(
		"gpt-6-astra",
	);
});

it("idle 中の使用量通知を取り込み、別会話と不正な最大値を無視する", async () => {
	const { controller, connections } = await setup();
	const update = connections[0]!.callbacks.update;
	update({
		sessionId: "settings",
		update: { sessionUpdate: "usage_update", used: 60, size: 100 },
	});
	expect(controller.snapshot().usage).toEqual({ used: 60, size: 100 });
	update({
		sessionId: "other",
		update: { sessionUpdate: "usage_update", used: 90, size: 100 },
	});
	update({
		sessionId: "settings",
		update: { sessionUpdate: "usage_update", used: 90, size: 0 },
	});
	expect(controller.snapshot().usage).toEqual({ used: 60, size: 100 });
	update({
		sessionId: "settings",
		update: { sessionUpdate: "config_option_update", configOptions: [] },
	});
	expect(controller.snapshot().configOptions).toEqual([]);
});

it("添付ファイルだけを開き、プロンプトに resource_link を含める", async () => {
	const { controller, connections, files } = await setup();
	await controller.receive({
		type: "attachment/add",
		requestId: "add",
		sessionId: "settings",
	});
	await controller.receive({
		type: "attachment/add",
		requestId: "add-again",
		sessionId: "settings",
	});
	expect(controller.snapshot().attachments).toHaveLength(1);
	await controller.receive({
		type: "attachment/open",
		requestId: "invalid",
		sessionId: "settings",
		attachmentId: "unknown",
	});
	expect(files.open).not.toHaveBeenCalled();
	await controller.receive({
		type: "attachment/open",
		requestId: "open",
		sessionId: "settings",
		attachmentId: "file",
	});
	expect(files.open).toHaveBeenCalledWith({
		id: "file",
		name: "code.ts",
		uri: "file:///workspace/code.ts",
	});
	const turn = controller.receive({
		type: "prompt/send",
		requestId: "send",
		sessionId: "settings",
		text: "review",
	});
	expect(connections[0]!.transport.prompt).toHaveBeenCalledWith(
		"settings",
		"review",
		[
			{
				type: "resource_link",
				name: "code.ts",
				uri: "file:///workspace/code.ts",
			},
		],
	);
	expect(controller.snapshot().attachments).toEqual([]);
	connections[0]!.result.resolve({ stopReason: "end_turn" });
	await turn;
});

it("切断後に戻った設定応答・ファイル選択を新しい会話へ混入させない", async () => {
	const { controller, connections, files, session } = await setup();
	const response = deferred<SetSessionConfigOptionResponse>();
	vi.mocked(connections[0]!.transport.setConfig).mockReturnValueOnce(
		response.promise,
	);
	const changing = controller.receive({
		type: "config/set",
		requestId: "change",
		sessionId: "settings",
		configId: "mode",
		value: "agent",
	});
	const selected = deferred<Awaited<ReturnType<typeof files.pick>>>();
	files.pick.mockReturnValueOnce(selected.promise);
	const picking = controller.receive({
		type: "attachment/add",
		requestId: "pick",
		sessionId: "settings",
	});
	controller.invalidate();
	response.resolve({ configOptions: session.configOptions });
	selected.resolve([
		{ id: "late", name: "late.txt", uri: "file:///late.txt" },
	]);
	await Promise.all([changing, picking]);
	expect(controller.snapshot().attachments).toEqual([]);
	expect(controller.snapshot().configPending).toBe(false);
	expect(controller.snapshot().attachmentPending).toBe(false);
	expect(controller.snapshot().configOptions[0]?.currentValue).toBe(
		"read-only",
	);
});
