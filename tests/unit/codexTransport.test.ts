// 実プロセスで JSONL の分割・双方向要求・切断時の待機解除を検証する。
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { AppServerTransport } from "../../src/extension/codex/AppServerTransport";
import { startAppServerProcess } from "../../src/extension/codex/AppServerProcess";

const initializeParams = {
	clientInfo: { name: "test", title: null, version: "0.0.1" },
	capabilities: { experimentalApi: false, requestAttestation: false },
};
/** 空白と日本語を含む作業場所でテスト用プロセスを起動する。 */
async function fixture(mode: string, timeoutMs = 2000) {
	const cwd = path.resolve("dist", "codex 通信 tests", randomUUID());
	await mkdir(cwd, { recursive: true });
	const child = spawn(
		process.execPath,
		[path.resolve("tests/fixtures/codex-app-server.mjs"), mode],
		{
			cwd,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	const notification = vi.fn();
	const disconnected = vi.fn();
	const transport = new AppServerTransport(
		child,
		{ notification, disconnected },
		timeoutMs,
	);
	return { transport, cwd, child, notification, disconnected };
}
/** 初期化応答を待ってから通知する本番と同じ接続順序。 */
async function initialize(transport: AppServerTransport) {
	const response = await transport.request("initialize", initializeParams);
	transport.notify({ method: "initialized" });
	return response;
}
/** 終了したプロセスを PID で確認する。 */
function running(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

it("UTF-8 分割・通知・逆順応答・同じ ID のサーバー要求を扱う", async () => {
	const { transport, notification, disconnected } =
		await fixture("serverRequests");
	try {
		expect((await initialize(transport)).userAgent).toBe("Codex 日本語");
		const slow = transport.request("thread/loaded/list", {
			cursor: "slow",
		});
		const fast = transport.request("thread/loaded/list", {
			cursor: "fast",
		});
		expect((await fast).data).toEqual(["fast"]);
		expect((await slow).data).toEqual(["slow"]);
		expect(notification).toHaveBeenCalledWith({
			method: "fixture/ready",
			params: { text: "準備完了" },
		});
	} finally {
		await transport.dispose();
	}
	expect(disconnected).not.toHaveBeenCalled();
});

it.each(["disconnect", "malformed", "timeout"])(
	"%s で全保留要求を失敗させ、切断を一度だけ通知する",
	async (mode) => {
		const { transport, disconnected, child } = await fixture(mode, 1000);
		try {
			await initialize(transport);
			const results = await Promise.allSettled([
				transport.request("thread/loaded/list", {}),
				transport.request("thread/loaded/list", {}),
			]);
			expect(results.map((result) => result.status)).toEqual([
				"rejected",
				"rejected",
			]);
			expect(disconnected).toHaveBeenCalledTimes(1);
			await expect(
				transport.request("thread/loaded/list", {}),
			).rejects.toThrow("切断");
		} finally {
			await transport.dispose();
		}
		expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
	},
);

it("RPC エラーのコードと詳細を保持する", async () => {
	const { transport, disconnected } = await fixture("rpcError");
	try {
		await initialize(transport);
		await expect(
			transport.request("thread/loaded/list", {}),
		).rejects.toMatchObject({ code: -32602, data: { field: "cursor" } });
		expect(disconnected).not.toHaveBeenCalled();
	} finally {
		await transport.dispose();
	}
});

it("生成型に一致しない応答を公開しない", async () => {
	const { transport } = await fixture("wrongResult");
	try {
		await initialize(transport);
		await expect(
			transport.request("thread/loaded/list", {}),
		).rejects.toThrow("不正");
	} finally {
		await transport.dispose();
	}
});

it("送信ストリームの異常を未処理エラーにしない", async () => {
	const { transport, child, disconnected } = await fixture("timeout");
	try {
		await initialize(transport);
		const result = transport.request("thread/loaded/list", {});
		child.stdin.destroy(new Error("fixture write failure"));
		await expect(result).rejects.toThrow("送信");
		expect(disconnected).toHaveBeenCalledTimes(1);
	} finally {
		await transport.dispose();
	}
});

it("起動失敗と二重 dispose でも待機を残さない", async () => {
	const transport = new AppServerTransport(
		startAppServerProcess(
			path.resolve("dist/missing-codex.exe"),
			process.cwd(),
		),
	);
	await expect(
		transport.request("initialize", initializeParams),
	).rejects.toThrow();
	await Promise.all([transport.dispose(), transport.dispose()]);
});

it.skipIf(process.platform !== "win32")(
	"dispose で孫プロセスと保留要求を解放する",
	async () => {
		const { transport, cwd, disconnected } = await fixture("tree");
		try {
			await initialize(transport);
			const pids = JSON.parse(
				await readFile(path.join(cwd, "pids.json"), "utf8"),
			) as number[];
			expect(pids.every(running)).toBe(true);
			const pending = transport
				.request("thread/loaded/list", {})
				.catch(() => "disposed");
			await Promise.all([transport.dispose(), transport.dispose()]);
			expect(await pending).toBe("disposed");
			await vi.waitFor(() => expect(pids.some(running)).toBe(false));
			expect(disconnected).not.toHaveBeenCalled();
		} finally {
			await transport.dispose();
		}
	},
);
