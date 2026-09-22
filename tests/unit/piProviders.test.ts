// 仮のproviderを登録し、共通処理を変更せず追加設定・要求・利用枠を委譲できることを確認する。
import { describe, expect, it, vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
	PiModelControls,
	PiProviders,
} from "../../src/extension/backends/pi/PiProvider";
import { PiProviderControls } from "../../src/extension/backends/pi/PiProviderControls";
import { PiQuotaService } from "../../src/extension/backends/pi/PiQuotaService";

describe("Pi providerの登録境界", () => {
	it("追加providerの設定候補・操作・要求変換を登録だけで有効化する", () => {
		const session = {
			model: { provider: "test-provider", id: "test" },
			thinkingLevel: "low",
			getAvailableThinkingLevels: () => ["low", "high"],
			setThinkingLevel: vi.fn(),
		};
		const plugin: PiModelControls = {
			bind: vi.fn(),
			reset: vi.fn(),
			snapshot: () => ({
				provider: "test-provider",
				modelId: "test",
				thinkingLevel: "low",
				effectiveReasoning: "low",
				reasoningOverride: null,
				fastMode: false,
			}),
			reasoningOptions: [],
			configOptions: [
				{
					id: "test-setting",
					name: "Test",
					currentValue: "on",
					options: [{ value: "on", name: "On" }],
				},
			],
			selectReasoning: vi.fn(),
			configure: vi.fn(() => true),
			rewrite: vi.fn(() => ({ test: true })),
		};
		const controls = new PiProviderControls({
			"test-provider": { createControls: () => plugin },
		});
		const sdkSession = session as unknown as AgentSession;
		controls.bind(sdkSession);
		expect(controls.configOptions[0]?.id).toBe("test-setting");
		const signal = new AbortController().signal;
		controls.configure("test-setting", "off", signal);
		expect(plugin.configure).toHaveBeenCalledWith(
			"test-setting",
			"off",
			signal,
		);
		expect(controls.rewrite({}, sdkSession.model)).toEqual({ test: true });
		session.model = { provider: "unregistered", id: "plain" };
		expect(controls.snapshot()).toMatchObject({
			provider: "unregistered",
			effectiveReasoning: "low",
		});
		expect(plugin.reset).toHaveBeenCalledOnce();
		expect(controls.configOptions).toEqual([]);
		expect(controls.rewrite({}, sdkSession.model)).toBeUndefined();
		controls.selectReasoning("high", signal);
		expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
		expect(() =>
			controls.configure("test-setting", "on", signal),
		).toThrow();
	});
	it("providerの利用枠サービスを選び、未登録providerでは取得しない", async () => {
		const read = vi.fn(() =>
			Promise.resolve([{ label: "Daily", remaining: 23, detail: "" }]),
		);
		const providers: PiProviders = {
			"test-provider": { createQuota: () => ({ read }) },
		};
		const session = { model: { provider: "test-provider", id: "test" } };
		const request = vi.fn<typeof fetch>();
		const service = new PiQuotaService(
			{} as unknown as ModelRuntime,
			session as unknown as AgentSession,
			request,
			providers,
		);
		expect(await service.read(new AbortController().signal)).toMatchObject([
			{ label: "Daily", remaining: 23 },
		]);
		session.model = { provider: "unregistered", id: "plain" };
		expect(await service.read(new AbortController().signal)).toBeNull();
		expect(read).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
	});
});
