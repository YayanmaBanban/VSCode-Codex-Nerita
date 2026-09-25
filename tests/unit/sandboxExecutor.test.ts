// network=`false` の正常実行、準備失敗、`Stop` 競合、接続回収を検証する。OS 隔離は実機疎通テストで確認する。
import { afterEach, expect, it, vi } from "vitest";
import { CodexSandboxExecutor } from "../../src/extension/backends/codex/CodexSandboxExecutor";
import { issueApprovedToolCall } from "../../src/extension/security/ApprovedToolCall";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** 本物の `cwd` と `root` を使い、接続の応答だけを模擬する。 */
async function fixture() {
	const files = await sandboxFixture();
	fixtures.push(files);
	const abort = new AbortController();
	const client = {
		readSandboxConfig: vi.fn(() =>
			Promise.resolve({ sandbox: "elevated" }),
		),
		readSandboxReadiness: vi.fn<
			() => Promise<{
				status: "ready" | "notConfigured" | "updateRequired";
			}>
		>(() => Promise.resolve({ status: "ready" })),
		executeCommand: vi.fn(() =>
			Promise.resolve({
				stdout: "日本語\r\n",
				stderr: "err",
				exitCode: 7,
			}),
		),
		terminateCommand: vi.fn(() => Promise.resolve({})),
		dispose: vi.fn(() => Promise.resolve()),
	};
	const connect = vi.fn(() => Promise.resolve(client));
	const executor = new CodexSandboxExecutor(connect, "win32");
	const call = {
		tool: "powershell",
		params: { command: "original" },
		cwd: files.cwd,
		policy: files.policy,
		command: ["pwsh", "-Command", "original"],
		timeoutMs: 60_000,
		env: { TOKEN: null },
	};
	const run = () =>
		executor.execute(issueApprovedToolCall(call, abort.signal));
	return { ...files, abort, client, connect, call, executor, run };
}

it("U06 network=falseでも要求commandを実行し、出力を保持して一度だけ回収する", async () => {
	const h = await fixture();
	expect(await h.run()).toEqual({
		stdout: "日本語\r\n",
		stderr: "err",
		exitCode: 7,
	});
	expect(h.client.executeCommand).toHaveBeenCalledWith(
		expect.objectContaining({
			command: h.call.command,
			cwd: h.cwd,
			env: { TOKEN: null },
			timeoutMs: 60_000,
			sandboxPolicy: {
				type: "workspaceWrite",
				writableRoots: [h.cwd],
				networkAccess: false,
				excludeTmpdirEnvVar: true,
				excludeSlashTmp: true,
			},
		}),
	);
	expect(h.client.dispose).toHaveBeenCalledTimes(1);
});

it.each(["darwin", "linux"] as const)(
	"%sではCodex実行経路を停止し、接続・実行しない",
	async (platform) => {
		const h = await fixture();
		const executor = new CodexSandboxExecutor(h.connect, platform);
		await expect(
			executor.execute(issueApprovedToolCall(h.call, h.abort.signal)),
		).rejects.toThrow(`${platform}に対応していません`);
		expect(h.connect).not.toHaveBeenCalled();
		expect(h.client.executeCommand).not.toHaveBeenCalled();
	},
);

it.each(["notConfigured", "updateRequired"] as const)(
	"U05 readiness=%sではcommandを呼ばない",
	async (status) => {
		const h = await fixture();
		h.client.readSandboxReadiness.mockResolvedValue({ status });
		await expect(h.run()).rejects.toThrow(status);
		expect(h.client.executeCommand).not.toHaveBeenCalled();
		expect(h.client.dispose).toHaveBeenCalledTimes(1);
	},
);

it("U04 接続中のStopはcommand起動前に回収する", async () => {
	const h = await fixture();
	const connection = pending<typeof h.client>();
	h.connect.mockReturnValue(connection.promise);
	const result = h.run();
	const rejected = expect(result).rejects.toThrow();
	await vi.waitFor(() => expect(h.connect).toHaveBeenCalled());
	h.abort.abort();
	connection.resolve(h.client);
	await rejected;
	expect(h.client.executeCommand).not.toHaveBeenCalled();
	expect(h.client.dispose).toHaveBeenCalledTimes(1);
});

it("U06 abort/finally競合は同じ回収の完了を待つ", async () => {
	const h = await fixture();
	const command = pending<{
		stdout: string;
		stderr: string;
		exitCode: number;
	}>();
	const closing = pending<void>();
	h.client.executeCommand.mockReturnValue(command.promise);
	h.client.dispose.mockReturnValue(closing.promise);
	const result = h.run();
	const rejected = expect(result).rejects.toThrow();
	await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalled());
	h.abort.abort();
	command.reject(new Error("stopped"));
	await vi.waitFor(() => expect(h.client.dispose).toHaveBeenCalledTimes(1));
	let finished = false;
	void result.catch(() => {
		finished = true;
	});
	await Promise.resolve();
	expect(finished).toBe(false);
	closing.resolve();
	await rejected;
	expect(h.client.terminateCommand).toHaveBeenCalledTimes(1);
});

it("U05 RPC拒否は専用接続を回収し、Host fallbackを呼ばない", async () => {
	const h = await fixture();
	h.client.executeCommand.mockRejectedValue(new Error("unsupported sandbox"));
	await expect(h.run()).rejects.toThrow("unsupported sandbox");
	expect(h.client.dispose).toHaveBeenCalledTimes(1);
});

it("U01 cwdの暗黙追加で子のwrite範囲を拡大しない", async () => {
	const h = await fixture();
	h.call.policy = { ...h.policy, writableRoots: [h.outside] };
	await expect(h.run()).rejects.toThrow("書込み許可範囲外");
	expect(h.connect).not.toHaveBeenCalled();
});
