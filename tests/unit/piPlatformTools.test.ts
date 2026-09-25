// OS分岐を模擬し、SandboxなしでのSDK実行とCodexへの非接続を検証する。
import { afterEach, expect, it, vi } from "vitest";
import * as sdk from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { preparePiRuntimeTools } from "../../src/extension/backends/pi/PiRuntimeTools";
import { loadPiResources } from "../../src/extension/backends/pi/PiResources";
import type { PiRuntimeOptions } from "../../src/extension/backends/pi/PiRuntime";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";

const codex = vi.hoisted(() => ({
	resolveWindowsSandbox: vi.fn(),
	createCodexSandboxExecutor: vi.fn(),
}));
vi.mock("../../src/extension/backends/codex/CodexSandboxExecutor", () => codex);
const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	await Promise.all(fixtures.splice(0).map((files) => files.cleanup()));
});

/** 実SDKのShell処理を使い、OSプロセス生成だけを観測可能な操作へ差し替える。 */
async function fixture(
	platform: "darwin" | "linux",
	extra: Partial<PiRuntimeOptions> = {},
) {
	const h = await sandboxFixture();
	fixtures.push(h);
	vi.stubGlobal("process", { ...process, platform });
	const abort = new AbortController();
	const authorize = vi.fn((_title: string, signal?: AbortSignal) =>
		Promise.resolve(signal ?? abort.signal),
	);
	const exec = vi.fn<sdk.BashOperations["exec"]>(
		(_command, _cwd, options) => {
			options.onData(Buffer.from("v22.fixture\n"));
			return Promise.resolve({ exitCode: 0 });
		},
	);
	const createBashToolDefinition = vi.fn(
		(cwd: string, options?: sdk.BashToolOptions) =>
			sdk.createBashToolDefinition(cwd, {
				...options,
				operations: { exec },
			}),
	);
	const prepared = await preparePiRuntimeTools(
		{ ...sdk, createBashToolDefinition },
		{ extensionPath: ".", cwd: h.cwd, signal: abort.signal, ...extra },
		authorize,
		{
			getShellPath: () => "configured-bash",
			getShellCommandPrefix: () => "configured-prefix",
		},
	);
	const rawContext: unknown = {
		cwd: h.cwd,
		sessionManager: sdk.SessionManager.inMemory(h.cwd),
	};
	const context = rawContext as Parameters<sdk.ToolDefinition["execute"]>[4];
	const bash = prepared.tools.find((tool) => tool.name === "bash")!;
	const run = () =>
		bash.execute(
			"shell",
			{ command: "node --version" },
			abort.signal,
			undefined,
			context,
		);
	return {
		...h,
		...prepared,
		abort,
		authorize,
		exec,
		run,
		context,
		createBashToolDefinition,
	};
}

it.each(["darwin", "linux"] as const)(
	"%sでSandbox設定を読まず、write/edit/bashを利用できる",
	async (platform) => {
		const h = await fixture(platform);
		expect(h.tools.map((tool) => tool.name)).toEqual([
			"write",
			"edit",
			"bash",
		]);
		expect(h.executor).toBeNull();
		expect(h.unavailable).toBeUndefined();
		const gate = pending<AbortSignal>();
		h.authorize.mockReturnValueOnce(gate.promise);
		const result = h.run();
		await vi.waitFor(() => expect(h.authorize).toHaveBeenCalledTimes(1));
		expect(h.exec).not.toHaveBeenCalled();
		gate.resolve(h.abort.signal);
		expect(JSON.stringify(await result)).toContain("v22.fixture");
		expect(h.exec.mock.calls[0]![0]).toBe(
			"configured-prefix\nnode --version",
		);
		expect(h.createBashToolDefinition.mock.calls[0]![1]?.shellPath).toBe(
			"configured-bash",
		);
		expect(h.authorize.mock.calls[0]![0]).toContain(
			"Pi Shell（OSの権限で実行）",
		);
		expect(h.authorize.mock.calls[0]![0]).not.toMatch(
			/Sandbox|network設定/,
		);
		await h.tools
			.find((tool) => tool.name === "write")!
			.execute(
				"write",
				{ path: "file.txt", content: "before" },
				h.abort.signal,
				undefined,
				h.context,
			);
		await h.tools
			.find((tool) => tool.name === "edit")!
			.execute(
				"edit",
				{
					path: "file.txt",
					edits: [{ oldText: "before", newText: "after" }],
				},
				h.abort.signal,
				undefined,
				h.context,
			);
		expect(await readFile(join(h.cwd, "file.txt"), "utf8")).toBe("after");
		expect(codex.resolveWindowsSandbox).not.toHaveBeenCalled();
		expect(codex.createCodexSandboxExecutor).not.toHaveBeenCalled();
	},
);

it("非WindowsではExecutor不在やWindows固有の利用不能理由でShellを止めない", async () => {
	const h = await fixture("linux", {
		executor: null,
		sandboxUnavailable: "Windows fixture unavailable",
	});
	expect(h.unavailable).toBeUndefined();
	await h.run();
	expect(h.exec).toHaveBeenCalledOnce();
	expect(codex.resolveWindowsSandbox).not.toHaveBeenCalled();
});

it("Host Shellでも明示したrole禁止・拒否・承認中Stopは実行しない", async () => {
	const denied = await fixture("darwin", { role: { shell: false } });
	await expect(denied.run()).rejects.toThrow("role");
	expect(denied.exec).not.toHaveBeenCalled();
	const h = await fixture("linux");
	h.authorize.mockRejectedValueOnce(new Error("declined"));
	await expect(h.run()).rejects.toThrow("declined");
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValueOnce(gate.promise);
	const result = h.run();
	const stopped = expect(result).rejects.toThrow();
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalledTimes(2));
	h.abort.abort();
	gate.resolve(h.abort.signal);
	await stopped;
	expect(h.exec).not.toHaveBeenCalled();
});

it("非Windowsでは信頼済みSandbox拡張のbashを登録して承認後に呼べる", async () => {
	const h = await fixture("linux");
	const entry = join(h.outside, "sandbox-extension.mjs");
	await writeFile(
		entry,
		'export default pi => pi.registerTool({ name: "bash", label: "external shell", description: "fixture", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }, execute: async () => ({ content: [{ type: "text", text: "external shell executed" }], details: {} }) });',
	);
	const resources = await loadPiResources(
		sdk,
		h.cwd,
		h.outside,
		sdk.SettingsManager.create(h.cwd, h.outside),
		h.authorize,
		h.abort.signal,
		undefined,
		[entry],
		h.paths.policy,
	);
	const bash = resources
		.getExtensions()
		.extensions.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "bash")!.definition;
	expect(
		JSON.stringify(
			await bash.execute(
				"external",
				{ command: "node --version" },
				h.abort.signal,
				undefined,
				h.context,
			),
		),
	).toContain("external shell executed");
	expect(h.authorize).toHaveBeenCalledOnce();
	expect(codex.createCodexSandboxExecutor).not.toHaveBeenCalled();
});
