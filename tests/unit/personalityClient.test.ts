// 実際のCodexClientを通し、開始・再開・分岐ごとに最新の指示を渡すことを確認する。
import { expect, it, vi } from "vitest";
import type { PersonalitySettings } from "../../src/shared/personality";
const fake = vi.hoisted(() => ({
	request: vi.fn().mockResolvedValue({}),
	read: vi.fn(),
	notify: vi.fn(),
}));
vi.mock("../../src/extension/codex/runtime", () => ({
	resolveCodexExecutable: () => Promise.resolve("codex.exe"),
}));
vi.mock("../../src/extension/codex/AppServerProcess", () => ({
	startAppServerProcess: vi.fn(),
}));
vi.mock("../../src/extension/codex/AppServerTransport", () => ({
	AppServerTransport: class {
		request = fake.request;
		notify = fake.notify;
	},
}));
vi.mock("../../src/extension/codex/PersonalityStore", () => ({
	PersonalityStore: class {
		read = fake.read;
	},
}));
import { CodexClient } from "../../src/extension/codex/CodexClient";
it("3種類のRPCへグローバル+ワークスペースを毎回読み直して渡す", async () => {
	const settings: PersonalitySettings = {
		global: {
			presets: [{ name: "g", text: "global" }],
			selected: "g",
			configuredText: null,
		},
		workspace: {
			presets: [{ name: "w", text: "workspace" }],
			selected: "w",
			configuredText: null,
		},
	};
	fake.read.mockImplementation(() => Promise.resolve(settings));
	const client = await CodexClient.connect({
		extensionPath: ".",
		cwd: "workspace",
		clientInfo: { name: "test", title: null, version: "1" },
	});
	await client.startThread({ cwd: "workspace" });
	expect(fake.request).toHaveBeenLastCalledWith("thread/start", {
		cwd: "workspace",
		developerInstructions: "global\n\nworkspace",
	});
	settings.global.configuredText = "fixed";
	await client.resumeThread("thread-1", true);
	expect(fake.request).toHaveBeenLastCalledWith("thread/resume", {
		threadId: "thread-1",
		excludeTurns: true,
		developerInstructions: "fixed\n\nworkspace",
	});
	await client.forkThread("thread-1");
	expect(fake.request).toHaveBeenLastCalledWith("thread/fork", {
		threadId: "thread-1",
		excludeTurns: false,
		developerInstructions: "fixed\n\nworkspace",
	});
	settings.global.configuredText = "";
	settings.workspace.selected = "";
	await client.resumeThread("thread-1");
	expect(fake.request).toHaveBeenLastCalledWith("thread/resume", {
		threadId: "thread-1",
		excludeTurns: false,
		developerInstructions: "",
	});
});
