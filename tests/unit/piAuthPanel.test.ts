// VS Codeのパネル境界を差し替え、入力の寿命・秘密値・取消を検証する。
import { expect, it, vi } from "vitest";
import { createPiAuthService } from "../../src/extension/backends/pi/PiAuthService";
import type { PiAuthState } from "../../src/shared/piAuth";
import { Uri } from "vscode";

const panel = vi.hoisted(() => {
	const states: PiAuthState[] = [];
	return {
		receive: (_value: unknown) => {},
		closed: () => {},
		states,
		created: vi.fn(),
	};
});
vi.mock("vscode", () => ({
	ViewColumn: { Active: -1 },
	Uri: {
		file: () => ({ toString: () => "extension" }),
		joinPath: () => ({ toString: () => "asset" }),
		parse: (value: string) => value,
	},
	env: { openExternal: () => Promise.resolve(true) },
	window: {
		createWebviewPanel: (...args: unknown[]) => {
			panel.created(...args);
			return {
				webview: {
					html: "",
					cspSource: "test",
					asWebviewUri: () => ({ toString: () => "asset" }),
					postMessage: (state: PiAuthState) => {
						panel.states.push(structuredClone(state));
						return Promise.resolve(true);
					},
					onDidReceiveMessage: (
						callback: (value: unknown) => void,
					) => {
						panel.receive = callback;
						return { dispose() {} };
					},
				},
				onDidDispose: (callback: () => void) => {
					panel.closed = callback;
				},
				dispose: () => panel.closed(),
			};
		},
	},
}));

it("エディターで入力を受け付け、秘密値を通知せず、閉じると待機を中止する", async () => {
	panel.states.length = 0;
	const service = createPiAuthService(Uri.file("extension"));
	let configured = false;
	const received: string[] = [];
	const execute = vi.fn(async (_id: string, signal: AbortSignal) => {
		const value = await service
			.interaction(signal)
			.prompt({ type: "secret", message: "APIキー" });
		received.push(value);
		configured = true;
	});
	const done = service.manage(
		() =>
			Promise.resolve([
				{
					id: "test",
					name: "Test",
					configured,
					methods: [{ id: "test-key", name: "APIキー" }],
				},
				{
					id: "other",
					name: "Other",
					configured: false,
					methods: [{ id: "other-key", name: "APIキー" }],
				},
			]),
		execute,
		new AbortController().signal,
	);
	await vi.waitFor(() => expect(panel.created).toHaveBeenCalled());
	expect(panel.created.mock.calls.at(-1)?.[2]).toBe(-1);
	panel.receive({ type: "start", id: "unknown" });
	expect(execute).not.toHaveBeenCalled();
	panel.receive({ type: "start", id: "test-key" });
	await vi.waitFor(() => expect(panel.states.at(-1)?.prompt).not.toBeNull());
	const id = panel.states.at(-1)!.prompt!.id;
	panel.receive({ type: "answer", id: "stale", value: "ignored" });
	panel.receive({ type: "answer", id, value: "private-test-key" });
	await vi.waitFor(() =>
		expect(panel.states.at(-1)?.items[0]?.configured).toBe(true),
	);
	expect(received).toEqual(["private-test-key"]);
	expect(JSON.stringify(panel.states)).not.toContain("private-test-key");
	expect(panel.states.at(-1)?.feedback?.test?.notice).toBe(
		"認証情報を更新しました。",
	);
	panel.receive({ type: "start", id: "other-key" });
	await vi.waitFor(() => expect(panel.states.at(-1)?.prompt).not.toBeNull());
	panel.receive({ type: "cancel" });
	await vi.waitFor(() =>
		expect(panel.states.at(-1)?.feedback?.other?.error).toBe(
			"認証をキャンセルしました。",
		),
	);
	expect(panel.states.at(-1)?.feedback?.test).toEqual({
		notice: "認証情報を更新しました。",
		error: null,
	});
	panel.receive({ type: "start", id: "test-key" });
	await vi.waitFor(() => expect(panel.states.at(-1)?.prompt).not.toBeNull());
	panel.closed();
	await done;
	expect(received).toHaveLength(1);
});
