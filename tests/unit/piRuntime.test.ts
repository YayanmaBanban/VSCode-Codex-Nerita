// 保存モデルの復元と利用不可時のフォールバックを検証する。
import { describe, expect, it } from "vitest";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	resolvePiInitialModel,
	createPiRuntime,
	type PiRuntimeOptions,
} from "../../src/extension/backends/pi/PiRuntime";

/** 初期選択に必要な利用可能候補だけを用意する。 */
function fixture() {
	const models = [
		{ provider: "openai-codex", id: "astra" },
		{ provider: "local", id: "test" },
	];
	const runtime = {
		getAvailableSnapshot: () => models,
	} as unknown as ModelRuntime;
	const options: PiRuntimeOptions = {
		extensionPath: "fixture",
		cwd: "fixture",
		parentPolicy: {
			filesystem: {
				readableRoots: [],
				writableRoots: [],
				protectedPaths: [],
			},
			network: { enabled: false },
			command: { mode: "deny" },
		},
		signal: new AbortController().signal,
	};
	return { models, runtime, options };
}

describe("Piの起動モデル", () => {
	it("親policyの省略はSDK読込み前に拒否する", async () => {
		const options: unknown = {
			extensionPath: "missing",
			cwd: "missing",
			signal: new AbortController().signal,
		};
		await expect(
			createPiRuntime(options as PiRuntimeOptions),
		).rejects.toThrow("親のaccess policy");
	});
	it("最後に選択したモデルを使う", () => {
		const h = fixture();
		expect(
			resolvePiInitialModel(
				{
					...h.options,
					preferredModel: { provider: "local", model: "test" },
				},
				h.runtime,
			),
		).toBe(h.models[1]);
	});
	it("保存値がなければSDKの初期選択を使う", () => {
		const h = fixture();
		expect(resolvePiInitialModel(h.options, h.runtime)).toBeUndefined();
	});
	it.each(["removed", ""])(
		"保存モデル%sが利用不可なら同じproviderへ戻す",
		(model) => {
			const h = fixture();
			expect(
				resolvePiInitialModel(
					{
						...h.options,
						preferredModel: { provider: "local", model },
					},
					h.runtime,
				),
			).toBe(h.models[1]);
		},
	);
	it("providerが消えた場合は利用可能な候補へ戻す", () => {
		const h = fixture();
		expect(
			resolvePiInitialModel(
				{
					...h.options,
					preferredModel: { provider: "missing", model: "missing" },
				},
				h.runtime,
			),
		).toBe(h.models[0]);
	});
	it("利用可能モデルがなくても起動エラーにしない", () => {
		const h = fixture();
		h.models.length = 0;
		expect(
			resolvePiInitialModel(
				{
					...h.options,
					preferredModel: { provider: "missing", model: "missing" },
				},
				h.runtime,
			),
		).toBeUndefined();
	});
});
