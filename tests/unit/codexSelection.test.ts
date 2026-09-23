// 永続ストレージとControllerを通し、再起動・送信・履歴の設定を検証する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness, historyThread } from "./codexHarness";
import { codexSelectionStore } from "../../src/extension/backends/codex/settings/modelSelection";
import type { ModelInfo } from "../../src/extension/backends/codex/protocol/account";

const sessions: ReturnType<typeof codexHarness>[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((h) => h.session.dispose()));
});

/** 同じglobalState相当の保存先を、独立したControllerへ渡す。 */
function fixture(initial?: unknown) {
	let stored = initial;
	const storage = {
		get: vi.fn(() => stored),
		update: vi.fn((_key: string, value: unknown) => {
			stored = value;
			return Promise.resolve();
		}),
	};
	const store = codexSelectionStore(storage);
	const models: ModelInfo[] = ["test-model", "chosen"].map((model) => ({
		model,
		displayName: model,
		defaultReasoningEffort: "low",
		supportedReasoningEfforts: ["low", "high", "ultra"].map(
			(reasoningEffort) => ({
				reasoningEffort,
				description: reasoningEffort,
			}),
		),
		inputModalities: ["text"],
		serviceTiers: [],
	}));
	const create = async () => {
		const h = codexHarness(store);
		sessions.push(h);
		h.client.listModels.mockResolvedValue({
			data: models,
			nextCursor: null,
		});
		h.client.listThreads.mockResolvedValue({
			data: [historyThread()],
			nextCursor: null,
		});
		await h.session.connect();
		return h;
	};
	return { storage, store, create, models };
}

/** 現在の会話へのUI設定要求を送る。 */
async function configure(
	h: ReturnType<typeof codexHarness>,
	configId: string,
	value: string,
) {
	await h.session.receive({
		type: "config/set",
		requestId: crypto.randomUUID(),
		sessionId: h.session.snapshot().sessionId,
		configId,
		value,
	});
}

it("モデルとUltraを保存し、独立した起動後の送信に復元する", async () => {
	const f = fixture();
	const first = await f.create();
	await configure(first, "model", "chosen");
	await configure(first, "reasoning_effort", "ultra");
	expect(f.storage.update).toHaveBeenLastCalledWith(
		"nerita.codex.lastModel",
		{ model: "chosen", reasoning: "ultra" },
	);
	const restarted = await f.create();
	expect(restarted.session.snapshot().configOptions).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: "model", currentValue: "chosen" }),
			expect.objectContaining({
				id: "reasoning_effort",
				currentValue: "ultra",
			}),
		]),
	);
	await restarted.send();
	expect(restarted.client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({ model: "chosen", effort: "ultra" }),
	);
});

it.each([
	{ model: "removed", reasoning: "ultra" },
	{ model: "test-model", reasoning: "removed" },
])("利用できない保存値%jは対応する初期値へ戻す", async (saved) => {
	const h = await fixture(saved).create();
	expect(h.session.snapshot().connection).toBe("ready");
	await h.send();
	expect(h.client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({ model: "test-model", effort: "low" }),
	);
});

it("履歴復元は保存した起動設定で上書きせず、新規会話で再び復元する", async () => {
	const f = fixture({ model: "chosen", reasoning: "ultra" });
	const h = await f.create();
	await h.session.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "saved",
	});
	expect(
		h.session.snapshot().configOptions.find((item) => item.id === "model")
			?.currentValue,
	).toBe("test-model");
	expect(f.storage.update).not.toHaveBeenCalled();
	await h.session.receive({ type: "session/new", requestId: "new" });
	expect(
		h.session.snapshot().configOptions.find((item) => item.id === "model")
			?.currentValue,
	).toBe("chosen");
});

it("無効なUI要求は永続化せず、壊れた保存値でも接続できる", async () => {
	const f = fixture({ model: 42 });
	const h = await f.create();
	await configure(h, "model", "missing");
	expect(f.storage.update).not.toHaveBeenCalled();
	expect(h.session.snapshot().connection).toBe("ready");
});

it("カタログを取得できない場合は保存値を送信せず初期設定を維持する", async () => {
	const f = fixture({ model: "removed", reasoning: "ultra" });
	f.models.length = 0;
	const h = await f.create();
	await h.send();
	expect(h.client.startTurn.mock.calls[0]?.[0].model).toBeUndefined();
	expect(h.client.startTurn.mock.calls[0]?.[0].effort).toBeUndefined();
});
