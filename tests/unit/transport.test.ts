// 実プロセスを用い、空白パス・切断・保留 RPC と孫プロセス終了を検証する。
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createTransport } from "../../src/extension/acp/transport";
/** OS 上にプロセスが残っているかを PID で確認する。 */
function running(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
it("空白のある作業パスで通信し、終了時に孫プロセスと保留 RPC を解放する", async () => {
	const cwd = path.resolve("dist", "transport tests", randomUUID());
	await mkdir(cwd, { recursive: true });
	const log = vi.fn();
	const disconnected = vi.fn();
	const transport = createTransport(
		process.execPath,
		path.resolve("tests/fixtures/acp-agent.mjs"),
		cwd,
		{
			update: vi.fn(),
			permission: () =>
				Promise.resolve({ outcome: { outcome: "cancelled" } }),
			disconnected,
		},
		log,
	);
	try {
		expect((await transport.initialize()).protocolVersion).toBe(1);
		expect((await transport.newSession()).sessionId).toBe("fixture");
		const pids = JSON.parse(
			await readFile(path.join(cwd, "pids.json"), "utf8"),
		) as number[];
		expect(pids.every(running)).toBe(true);
		const pending = transport
			.prompt("fixture", "hello")
			.catch(() => "closed");
		await transport.dispose();
		expect(await pending).toBe("closed");
		await vi.waitFor(() => expect(pids.some(running)).toBe(false));
		expect(disconnected).not.toHaveBeenCalled();
		// 正常な通信や adapter の診断内容はログへ出力しない。
		expect(log).not.toHaveBeenCalled();
	} finally {
		await transport.dispose();
	}
}, 15000);
