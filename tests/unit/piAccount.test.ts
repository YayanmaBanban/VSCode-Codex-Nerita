// 認証の公開境界と、設定中・旧セッションからの要求を検証する。
import { describe, expect, it, vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiAccount } from "../../src/extension/backends/pi/PiAccount";
import { piHarness, pending } from "./piHarness";

describe("Piの認証・モデル", () => {
	it.each(["cancel", "invalidate"])(
		"認証待ちは%sで中断し、旧接続から状態を戻さない",
		async (action) => {
			const h = piHarness();
			let signal: AbortSignal | undefined;
			h.runtime.account = {
				refreshCatalog: () => Promise.resolve(),
				snapshot: () => ({ connection: "ready", piAccount: "test" }),
				authenticate: (_logout: boolean, incoming: AbortSignal) => {
					signal = incoming;
					return new Promise<void>((_resolve, reject) =>
						incoming.addEventListener(
							"abort",
							() => reject(new Error("cancelled")),
							{ once: true },
						),
					);
				},
			} as unknown as PiAccount;
			await h.controller.connect();
			const operation = h.controller.receive({
				type: "auth/start",
				requestId: "auth",
				methodId: "pi",
			});
			if (action === "cancel") {
				await h.controller.receive({
					type: "auth/start",
					requestId: "cancel",
					methodId: "pi-cancel",
				});
			} else {
				h.controller.invalidate();
			}
			await operation;
			expect(signal?.aborted).toBe(true);
			expect(h.controller.snapshot().connection).toBe(
				action === "cancel" ? "ready" : "disconnected",
			);
			await h.controller.dispose();
		},
	);
	it("利用可能モデルだけを公開し、認証値を状態に含めない", async () => {
		const model = { provider: "local", id: "test", name: "Local" };
		const models = {
			getAvailableSnapshot: () => [model],
			getAvailable: () => Promise.resolve([model]),
			getProviderAuthStatus: () => ({ configured: true }),
			isUsingOAuth: () => true,
		} as unknown as ModelRuntime;
		const setModel = vi.fn();
		const session = {
			model,
			setModel,
			thinkingLevel: "off",
			getAvailableThinkingLevels: () => ["off"],
		} as unknown as AgentSession;
		const saveModel = vi.fn(() => Promise.resolve());
		const account = new PiAccount(
			models,
			session,
			undefined,
			undefined,
			undefined,
			saveModel,
		);
		expect(account.snapshot()).toMatchObject({
			connection: "ready",
			piAccount: "local: OAuth設定済み",
			configOptions: [
				{ options: [{ value: "local/test" }] },
				{
					id: "reasoning_effort",
					currentValue: "off",
					options: [{ value: "off" }],
				},
				{
					id: "provider",
					currentValue: "local",
					options: [{ value: "local" }],
				},
			],
		});
		await expect(
			account.selectModel("unknown/model", new AbortController().signal),
		).rejects.toThrow();
		expect(setModel).not.toHaveBeenCalled();
		await account.selectModel("local/test", new AbortController().signal);
		expect(setModel).toHaveBeenCalledWith(model);
		expect(saveModel).toHaveBeenCalledWith({
			provider: "local",
			model: "test",
			reasoning: "off",
		});
	});
	it("推論レベルを会話へ反映し、未対応値・旧会話・取消を拒否する", async () => {
		const h = piHarness();
		const session = {
			thinkingLevel: "low",
			getAvailableThinkingLevels: () => ["off", "low", "high"] as const,
			setThinkingLevel: vi.fn((level: string) => {
				session.thinkingLevel = level;
			}),
		};
		const account = new PiAccount(
			{ getAvailableSnapshot: () => [] } as unknown as ModelRuntime,
			session as unknown as AgentSession,
		);
		h.runtime.account = account;
		await h.controller.connect();
		await h.controller.receive({
			type: "config/set",
			requestId: "effort",
			sessionId: "pi-1",
			configId: "reasoning_effort",
			value: "high",
		});
		expect(session.setThinkingLevel).toHaveBeenCalledExactlyOnceWith(
			"high",
		);
		expect(h.controller.snapshot().configOptions[1]).toMatchObject({
			currentValue: "high",
			options: [{ value: "off" }, { value: "low" }, { value: "high" }],
		});
		await h.controller.receive({
			type: "config/set",
			requestId: "old-effort",
			sessionId: "old",
			configId: "reasoning_effort",
			value: "low",
		});
		await h.controller.receive({
			type: "config/set",
			requestId: "invalid-effort",
			sessionId: "pi-1",
			configId: "reasoning_effort",
			value: "xhigh",
		});
		expect(() =>
			account.selectThinkingLevel("low", AbortSignal.abort()),
		).toThrow();
		expect(session.setThinkingLevel).toHaveBeenCalledTimes(1);
		expect(h.controller.snapshot()).toMatchObject({
			configPending: false,
			sessionPending: false,
		});
		expect(
			h.events.filter((event) => event.type === "request/failed"),
		).toHaveLength(2);
		await h.controller.dispose();
	});
	it("認証中の再接続・送信を拒否し、取消後も会話を維持する", async () => {
		const h = piHarness();
		const wait = pending<void>();
		const authenticate = vi.fn(() => wait.promise);
		h.runtime.account = {
			refreshCatalog: () => Promise.resolve(),
			snapshot: () => ({
				connection: "ready",
				piAccount: "local: 設定済み",
			}),
			authenticate,
		} as unknown as PiAccount;
		await h.controller.connect();
		const operation = h.controller.receive({
			type: "auth/start",
			requestId: "auth",
			methodId: "pi",
		});
		expect(h.controller.snapshot().connection).toBe("authenticating");
		await h.send();
		await h.controller.receive({
			type: "connection/retry",
			requestId: "retry",
		});
		expect(h.factory).toHaveBeenCalledTimes(1);
		expect(h.runtime.prompt).not.toHaveBeenCalled();
		wait.reject(new Error("secret-token"));
		await operation;
		expect(h.controller.snapshot()).toMatchObject({
			connection: "ready",
			sessionId: "pi-1",
			configPending: false,
			sessionPending: false,
		});
		expect(JSON.stringify(h.events)).not.toContain("secret-token");
		await h.controller.dispose();
	});
	it("古い会話・未知の認証方法はSDKへ渡さない", async () => {
		const h = piHarness();
		const selectModel = vi.fn();
		const authenticate = vi.fn();
		h.runtime.account = {
			refreshCatalog: () => Promise.resolve(),
			snapshot: () => ({}),
			selectModel,
			authenticate,
		} as unknown as PiAccount;
		await h.controller.connect();
		await h.controller.receive({
			type: "config/set",
			requestId: "old",
			sessionId: "old",
			configId: "model",
			value: "local/test",
		});
		await h.controller.receive({
			type: "auth/start",
			requestId: "wrong",
			methodId: "wrong",
		});
		expect(selectModel).not.toHaveBeenCalled();
		expect(authenticate).not.toHaveBeenCalled();
		await h.controller.dispose();
	});
});
