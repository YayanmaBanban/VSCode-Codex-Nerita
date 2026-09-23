// SDKのコンテキスト推定量が共通UIへ届き、未知値や旧接続を持ち越さないことを確認する。
import { afterEach, expect, it, vi } from "vitest";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { assistant, piHarness } from "./piHarness";

const harnesses: ReturnType<typeof piHarness>[] = [];
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.controller.dispose()));
});

/** 使用量を差し替え、実際の通信validatorを通す。 */
function setup() {
	const h = piHarness();
	harnesses.push(h);
	h.controller.subscribe((event) => expect(isHostMessage(event)).toBe(true));
	return h;
}

it("接続時の使用量を復元し、ターンと実行完了で最新の推定量へ更新する", async () => {
	const h = setup();
	const usage = vi.mocked(h.runtime.getContextUsage);
	usage.mockReturnValue({
		tokens: 60000,
		contextWindow: 200000,
		percent: 30,
	});
	await h.controller.connect();
	expect(h.controller.snapshot().usage).toEqual({
		used: 60000,
		size: 200000,
	});
	await h.send();
	usage.mockReturnValue({
		tokens: 80000,
		contextWindow: 200000,
		percent: 40,
	});
	h.emit({ type: "turn_end", message: assistant("done"), toolResults: [] });
	expect(h.controller.snapshot().usage).toEqual({
		used: 80000,
		size: 200000,
	});
	usage.mockReturnValue({
		tokens: 90000,
		contextWindow: 200000,
		percent: 45,
	});
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	expect(h.controller.snapshot().usage).toEqual({
		used: 90000,
		size: 200000,
	});
	usage.mockReturnValue(undefined);
	await h.controller.receive({ type: "session/new", requestId: "new" });
	expect(h.controller.snapshot().usage).toBeNull();
});

it.each([
	undefined,
	{ tokens: null, contextWindow: 200000, percent: null },
	{ tokens: -1, contextWindow: 200000, percent: 0 },
	{ tokens: Number.NaN, contextWindow: 200000, percent: 0 },
	{ tokens: 1, contextWindow: 0, percent: 0 },
	{ tokens: 1, contextWindow: Infinity, percent: 0 },
])("取得不能・不正な使用量を未取得表示にする: %j", async (usage) => {
	const h = setup();
	vi.mocked(h.runtime.getContextUsage).mockReturnValue(usage);
	await h.controller.connect();
	expect(h.controller.snapshot().usage).toBeNull();
});
