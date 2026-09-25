// 実 SDK のスキーマを使い、公開可否・毎回承認・拒否・停止をシェル別に確認する。
import { afterEach, expect, it, vi } from "vitest";
import * as sdk from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createPiShellTools } from "../../src/extension/backends/pi/PiShellTools";
import {
	consumeApprovedToolCall,
	type ApprovedToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** 実際の実行ファイルは起動せず、起動確認と承認済み実行を `Executor` で区別する。 */
async function fixture(
	pwsh: "ready" | "missing" | "denied" | "workspace" = "ready",
) {
	const h = await sandboxFixture();
	fixtures.push(h);
	const windows = join(
		h.outside,
		"System32/WindowsPowerShell/v1.0/powershell.exe",
	);
	const core = join(
		pwsh === "workspace" ? h.cwd : h.outside,
		"PowerShell/7/pwsh.exe",
	);
	await mkdir(dirname(windows), { recursive: true });
	await writeFile(windows, "fixture");
	if (pwsh !== "missing") {
		await mkdir(dirname(core), { recursive: true });
		await writeFile(core, "fixture");
	}
	vi.stubEnv("SystemRoot", h.outside);
	vi.stubEnv("ProgramFiles", pwsh === "workspace" ? h.cwd : h.outside);
	vi.stubEnv("PATH", "");
	const abort = new AbortController();
	const authorize = vi.fn((_title: string, signal?: AbortSignal) =>
		Promise.resolve(signal ?? abort.signal),
	);
	const execute = vi.fn((permit: ApprovedToolCall) => {
		const call = consumeApprovedToolCall(permit);
		const probe = call.command!.at(-1)!.includes("NERITA_PWSH_READY");
		return Promise.resolve({
			stdout: probe ? "NERITA_PWSH_READY\r\n" : "v22.fixture\r\n",
			stderr: "",
			exitCode: probe && pwsh === "denied" ? 1 : 0,
		});
	});
	const tools = await createPiShellTools(
		sdk,
		h.paths,
		authorize,
		{
			execute,
			describe: () => ({
				name: "Fixture Sandbox",
				details: ["fixture isolation"],
			}),
		},
		abort.signal,
	);
	const rawContext: unknown = { cwd: h.cwd };
	const context = rawContext as Parameters<sdk.ToolDefinition["execute"]>[4];
	return { ...h, windows, core, abort, authorize, execute, tools, context };
}

it.each(["missing", "denied", "workspace"] as const)(
	"pwshが%sの場合は公開せずpowershellを維持する",
	async (state) => {
		const h = await fixture(state);
		expect(h.tools.map((tool) => tool.name)).toEqual(["powershell"]);
		expect(h.authorize).not.toHaveBeenCalled();
		expect(h.execute).toHaveBeenCalledTimes(state === "denied" ? 1 : 0);
	},
);

it.each(["powershell", "pwsh"] as const)(
	"%sの説明・argv・毎回承認を実際のShellへ対応させる",
	async (name) => {
		const h = await fixture();
		expect(h.tools.map((tool) => tool.name)).toEqual([
			"powershell",
			"pwsh",
		]);
		const tool = h.tools.find((tool) => tool.name === name)!;
		expect(tool.description).toContain(
			name === "powershell"
				? "Windows PowerShell (powershell.exe)"
				: "PowerShell 7 (pwsh.exe)",
		);
		expect(tool.description).toContain("pass the command body directly");
		expect(tool.description).not.toContain("Codex");
		expect(JSON.stringify(tool.parameters)).toContain("node --version");
		h.execute.mockClear();
		for (let count = 1; count <= 2; count++) {
			const gate = pending<AbortSignal>();
			h.authorize.mockReturnValueOnce(gate.promise);
			const result = tool.execute(
				"shell",
				{ command: "node --version" },
				undefined,
				undefined,
				h.context,
			);
			await vi.waitFor(() =>
				expect(h.authorize).toHaveBeenCalledTimes(count),
			);
			expect(h.execute).toHaveBeenCalledTimes(count - 1);
			expect(h.authorize.mock.calls.at(-1)![0]).toContain(`Pi: ${name}`);
			expect(h.authorize.mock.calls.at(-1)![0]).toContain(
				"Sandbox実装: Fixture Sandbox",
			);
			expect(h.authorize.mock.calls.at(-1)![0]).not.toContain(
				"Windows Sandbox:",
			);
			gate.resolve(h.abort.signal);
			expect(JSON.stringify(await result)).toContain("v22.fixture");
			const call = h.execute.mock.calls.at(-1)![0].call;
			expect(call.tool).toBe(name);
			expect(call.command![0]).toBe(
				name === "powershell" ? h.windows : h.core,
			);
			expect(call.command!.at(-1)).toMatch(/\nnode --version$/);
			expect(call.command!.at(-1)).toContain("chcp.com");
			expect(h.authorize.mock.calls.at(-1)![0]).toContain("chcp.com");
		}
	},
);

it.each(["powershell", "pwsh"] as const)(
	"%sの拒否・承認中StopはExecutorへ到達しない",
	async (name) => {
		const h = await fixture();
		const tool = h.tools.find((tool) => tool.name === name)!;
		h.execute.mockClear();
		h.authorize.mockRejectedValueOnce(new Error("declined"));
		await expect(
			tool.execute(
				"decline",
				{ command: "node --version" },
				undefined,
				undefined,
				h.context,
			),
		).rejects.toThrow("declined");
		const gate = pending<AbortSignal>();
		h.authorize.mockReturnValueOnce(gate.promise);
		const result = tool.execute(
			"stop",
			{ command: "node --version" },
			undefined,
			undefined,
			h.context,
		);
		const stopped = expect(result).rejects.toThrow();
		await vi.waitFor(() => expect(h.authorize).toHaveBeenCalledTimes(2));
		h.abort.abort();
		gate.resolve(h.abort.signal);
		await stopped;
		expect(h.execute).not.toHaveBeenCalled();
	},
);
