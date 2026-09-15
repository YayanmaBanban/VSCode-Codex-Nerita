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
	const update = vi.fn();
	const transport = createTransport(
		process.execPath,
		path.resolve("tests/fixtures/acp-agent.mjs"),
		cwd,
		{
			update,
			permission: () =>
				Promise.resolve({ outcome: { outcome: "cancelled" } }),
			disconnected,
		},
		log,
	);
	try {
		expect((await transport.initialize()).protocolVersion).toBe(1);
		expect(await transport.newSession()).toMatchObject({
			sessionId: "fixture",
			models: { currentModelId: "model-a[high]" },
		});
		expect(await transport.readStatus("fixture")).toEqual([
			{
				label: "codex 5h limit",
				remaining: 60,
				detail: "(resets 18:00)",
			},
		]);
		expect(update).not.toHaveBeenCalled();
		// 内部取得中に停止した通常送信は、キュー解放後にも発行しない。
		const status = transport.readStatus("fixture");
		const cancelled = transport
			.prompt("fixture", "must not send")
			.catch(() => "cancelled");
		await transport.cancel("fixture");
		await status;
		expect(await cancelled).toBe("cancelled");
		await expect(
			readFile(path.join(cwd, "prompt.json"), "utf8"),
		).rejects.toThrow();
		expect(
			await transport.setConfig("fixture", "model", "model-a"),
		).toMatchObject({ configOptions: [{ currentValue: "model-a" }] });
		expect(
			JSON.parse(await readFile(path.join(cwd, "config.json"), "utf8")),
		).toMatchObject({
			method: "session/set_config_option",
			params: {
				sessionId: "fixture",
				configId: "model",
				value: "model-a",
			},
		});
		const pids = JSON.parse(
			await readFile(path.join(cwd, "pids.json"), "utf8"),
		) as number[];
		expect(pids.every(running)).toBe(true);
		const pending = transport
			.prompt("fixture", "hello", [
				{
					type: "resource_link",
					name: "test.ts",
					uri: "file:///test.ts",
				},
			])
			.catch(() => "closed");
		await vi.waitFor(async () => {
			expect(
				JSON.parse(
					await readFile(path.join(cwd, "prompt.json"), "utf8"),
				),
			).toMatchObject({
				params: {
					prompt: [
						{ type: "text", text: "hello" },
						{
							type: "resource_link",
							uri: "file:///test.ts",
							name: "test.ts",
						},
					],
				},
			});
		});
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
