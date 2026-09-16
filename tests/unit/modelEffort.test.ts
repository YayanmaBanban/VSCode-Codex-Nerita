// モデル切替前の推論量が、表示と次のリクエストの両方へ引き継がれることを検証する。
import { afterEach, expect, it } from "vitest";
import { codexHarness } from "./codexHarness";

const sessions: ReturnType<typeof codexHarness>["session"][] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

it.each([
	{ supported: ["low", "high"], expected: "high" },
	{ supported: ["low"], expected: "low" },
])(
	"推論量の対応候補 $supported に合わせて $expected を送る",
	async ({ supported, expected }) => {
		const h = codexHarness();
		sessions.push(h.session);
		h.client.listModels.mockResolvedValue({
			data: [
				{ model: "test-model", efforts: ["low", "high"] },
				{ model: "next-model", efforts: supported },
			].map(({ model, efforts }) => ({
				model,
				displayName: model,
				defaultReasoningEffort: "low",
				supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
					reasoningEffort,
					description: reasoningEffort,
				})),
				inputModalities: ["text"],
				serviceTiers: [],
			})),
			nextCursor: null,
		});
		await h.session.connect();
		for (const [configId, value] of [
			["reasoning_effort", "high"],
			["model", "next-model"],
		]) {
			await h.session.receive({
				type: "config/set",
				requestId: crypto.randomUUID(),
				sessionId: h.session.snapshot().sessionId,
				configId,
				value,
			});
		}
		expect(
			h.session
				.snapshot()
				.configOptions.find(
					(option) => option.id === "reasoning_effort",
				)?.currentValue,
		).toBe(expected);
		await h.send();
		expect(h.client.startTurn).toHaveBeenCalledWith(
			expect.objectContaining({ model: "next-model", effort: expected }),
		);
	},
);
