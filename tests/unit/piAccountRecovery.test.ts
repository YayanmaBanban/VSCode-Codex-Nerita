// 認証後の旧モデル復帰・画面終了との競合・ログアウト後の再認証を検証する。
import { expect, it, vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
	PiAccount,
	type PiAuthService,
} from "../../src/extension/backends/pi/PiAccount";
import { piHarness, pending } from "./piHarness";

/** 認証とモデルの状態だけを差し替える SDK 境界。 */
function fixture(manage: PiAuthService["manage"], validCurrent = false) {
	const old = { provider: "old", id: "old", name: "Old" };
	const model = { provider: "new", id: "new", name: "New" };
	let stored = false;
	const available = () => [
		...(validCurrent ? [old] : []),
		...(stored ? [model] : []),
	];
	const login = vi.fn(() => {
		stored = true;
		return Promise.resolve();
	});
	const logout = vi.fn(() => {
		stored = false;
		return Promise.resolve();
	});
	const getAvailable = vi.fn(() => Promise.resolve(available()));
	const models = {
		getAvailable,
		getAvailableSnapshot: available,
		login,
		logout,
		getProviders: () => [
			{ id: "new", name: "New", auth: { apiKey: { login }, oauth: {} } },
		],
		listCredentials: () =>
			Promise.resolve(
				stored ? [{ providerId: "new", type: "api_key" }] : [],
			),
		getProviderAuthStatus: () => ({ configured: stored }),
		isUsingOAuth: () => false,
	} as unknown as ModelRuntime;
	const session = {
		thinkingLevel: "off",
		getAvailableThinkingLevels: () => ["off"],
		model: old,
		setModel: vi.fn((next: typeof model) => {
			session.model = next;
			return Promise.resolve();
		}),
	};
	const account = new PiAccount(models, session as unknown as AgentSession, {
		manage,
		interaction: (signal) => ({
			signal,
			prompt: () => Promise.resolve("test-only"),
			notify: () => {},
		}),
	});
	return { account, model, old, session, login, getAvailable };
}

it.each([false, true])(
	"認証完了・画面終了後は接続済みになる（現在のモデルが利用可能: %s）",
	async (validCurrent) => {
		const f = fixture(async (_items, execute, signal) => {
			await execute(JSON.stringify(["new", "api_key"]), signal);
		}, validCurrent);
		const h = piHarness();
		h.runtime.account = f.account;
		await h.controller.connect();
		await h.controller.receive({
			type: "auth/start",
			requestId: "login",
			methodId: "pi",
		});
		expect(h.controller.snapshot()).toMatchObject({
			connection: "ready",
			sessionPending: false,
			sessionId: "pi-1",
		});
		expect(f.session.model).toBe(validCurrent ? f.old : f.model);
		await h.controller.dispose();
	},
);

it("保存直後に画面を閉じて操作が中断しても、利用可能モデルを確定する", async () => {
	const gate = pending<{ provider: string; id: string; name: string }[]>();
	const f = fixture(async (_items, execute) => {
		const operation = new AbortController();
		const running = execute(
			JSON.stringify(["new", "api_key"]),
			operation.signal,
		);
		await vi.waitFor(() => expect(f.getAvailable).toHaveBeenCalledTimes(1));
		operation.abort();
		gate.resolve([f.model]);
		await expect(running).rejects.toThrow();
	});
	f.getAvailable.mockImplementationOnce(() => gate.promise);
	await f.account.authenticate(false, new AbortController().signal);
	expect(f.account.snapshot().connection).toBe("ready");
	expect(f.session.model).toBe(f.model);
});

it("ログアウトから開いて削除しても、同じ画面でAPIキーとOAuthを選べる", async () => {
	const f = fixture(async (items, execute, signal) => {
		await execute(JSON.stringify(["new", "logout"]), signal);
		const methods = (await items())[0]!.methods.map(
			(method) => method.name,
		);
		expect(methods).toEqual(["APIキーを設定", "OAuthでログイン"]);
		await execute(JSON.stringify(["new", "api_key"]), signal);
	});
	await f.login();
	await f.account.authenticate(true, new AbortController().signal);
	expect(f.account.snapshot().connection).toBe("ready");
});
