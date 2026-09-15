// 実プロセスで端末の出力制限、IDの寿命、個別停止と接続終了を検証する。
import { expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { Terminals } from "../../src/extension/acp/terminals";
import { createTransport } from "../../src/extension/acp/transport";
import type { SessionNotification } from "@agentclientprotocol/sdk";

it("UTF-8出力・環境・終了待ちを保持し、release後と別セッションを拒否する", async () => {
	const terminals = new Terminals(process.cwd(), vi.fn());
	terminals.allowSession("s");
	try {
		const { terminalId } = await terminals.create({
			sessionId: "s",
			command: process.execPath,
			args: [
				"-e",
				"process.stdout.write(process.env.TERMINAL_TEST_VALUE)",
			],
			env: [{ name: "TERMINAL_TEST_VALUE", value: "あいうえお" }],
			outputByteLimit: 7,
		});
		const ref = { sessionId: "s", terminalId };
		expect(await terminals.waitForExit(ref)).toMatchObject({ exitCode: 0 });
		expect(terminals.output(ref)).toMatchObject({
			output: "えお",
			truncated: true,
		});
		expect(() =>
			terminals.output({ ...ref, sessionId: "other" }),
		).toThrow();
		await terminals.release(ref);
		expect(() => terminals.output(ref)).toThrow();
		await expect(
			terminals.create({
				sessionId: "s",
				command: "missing-terminal-executable-999",
			}),
		).rejects.toThrow();
	} finally {
		await terminals.dispose();
	}
});

it("killは他の端末を止めず、releaseとdisposeは動作中の端末を終了する", async () => {
	const terminals = new Terminals(process.cwd(), vi.fn());
	terminals.allowSession("s");
	const start = async () => ({
		sessionId: "s",
		...(await terminals.create({
			sessionId: "s",
			command: process.execPath,
			args: ["-e", "setInterval(() => {}, 1000)"],
		})),
	});
	try {
		const first = await start();
		const second = await start();
		await terminals.kill(first);
		expect(terminals.output(first).exitStatus).toBeDefined();
		expect(terminals.output(second).exitStatus).toBeUndefined();
		const waiting = terminals.waitForExit(second);
		await terminals.release(second);
		await expect(waiting).resolves.toBeDefined();
		const third = await start();
		const last = terminals.waitForExit(third);
		await terminals.dispose();
		await expect(last).resolves.toBeDefined();
		await expect(start()).rejects.toThrow();
	} finally {
		await terminals.dispose();
	}
});

for (const mode of ["agent-kill", "ui-kill"]) {
	it(`ACPの端末ハンドラーと${mode}を実通信で検証する`, async () => {
		const update = vi.fn<(notification: SessionNotification) => void>();
		const transport = createTransport(
			process.execPath,
			resolve("tests/fixtures/terminal-agent.mjs"),
			process.cwd(),
			{
				update,
				permission: () =>
					Promise.resolve({ outcome: { outcome: "cancelled" } }),
				disconnected: vi.fn(),
			},
			vi.fn(),
		);
		try {
			await transport.initialize();
			const { sessionId } = await transport.newSession();
			const run = transport.prompt(sessionId, mode);
			if (mode === "ui-kill") {
				await vi.waitFor(() => expect(update).toHaveBeenCalled());
				const notification = update.mock.calls[0]![0].update;
				const content =
					notification.sessionUpdate === "tool_call"
						? notification.content?.[0]
						: undefined;
				if (content?.type !== "terminal") {
					throw new Error("Missing terminal");
				}
				const terminalId = content.terminalId;
				await transport.killTerminal(sessionId, terminalId);
			}
			await expect(run).resolves.toMatchObject({
				stopReason: "end_turn",
			});
		} finally {
			await transport.dispose();
		}
	});
}

it("端末が起動した子プロセスも停止する", async () => {
	const terminals = new Terminals(process.cwd(), vi.fn());
	terminals.allowSession("s");
	try {
		const ref = {
			sessionId: "s",
			...(await terminals.create({
				sessionId: "s",
				command: process.execPath,
				args: [
					"-e",
					"const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)",
				],
			})),
		};
		await vi.waitFor(() =>
			expect(terminals.output(ref).output.trim()).toMatch(/^\d+$/),
		);
		const pid = Number(terminals.output(ref).output.trim());
		await terminals.kill(ref);
		await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
	} finally {
		await terminals.dispose();
	}
});
