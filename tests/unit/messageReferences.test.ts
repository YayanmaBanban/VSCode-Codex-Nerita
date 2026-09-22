// 送信本文の位置補正・境界検証と、両backendの参照情報の保持を確認する。
import { afterEach, expect, it, vi } from "vitest";
import { promptReferences } from "../../src/shared/composerContent";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { codexHarness } from "./codexHarness";
import { piHarness } from "./piHarness";

const path = {
	kind: "file" as const,
	name: "a.ts",
	path: "D:/a.ts",
	uri: "file:///D:/a.ts",
};
const references = [{ offset: 0, path }];
const dispose: (() => Promise<void>)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(dispose.splice(0).map((fn) => fn()));
});

it("前後空白と貼り付けブロックをまたいだ参照位置を補正する", () => {
	const parts = [
		{
			id: "a",
			type: "text" as const,
			text: "  D:/a.ts\n",
			references: [{ offset: 2, path }],
		},
		{ id: "b", type: "pasted" as const, text: "code\n" },
		{ id: "c", type: "text" as const, text: "D:/a.ts  ", references },
	];
	expect(
		promptReferences(parts.map((part) => part.text).join(""), parts),
	).toEqual([
		{ offset: 0, path },
		{ offset: 13, path },
	]);
});

it("本文と一致しない参照や重なる参照はHostの入口で拒否する", () => {
	const message = {
		type: "prompt/send",
		requestId: "test",
		sessionId: "test",
		text: path.path,
		references,
	};
	expect(isUiMessage(message)).toBe(true);
	expect(isUiMessage({ ...message, text: "other" })).toBe(false);
	expect(
		isUiMessage({ ...message, references: [...references, ...references] }),
	).toBe(false);
});

for (const backend of ["codex", "pi"] as const) {
	it(`${backend}の通常送信と追加指示で本文と参照を保持する`, async () => {
		vi.useFakeTimers();
		const h = backend === "codex" ? codexHarness() : piHarness();
		const controller = "session" in h ? h.session : h.controller;
		dispose.push(() => controller.dispose());
		await controller.connect();
		for (const requestId of ["first", "second"]) {
			const pending = controller.receive({
				type: "prompt/send",
				requestId,
				sessionId: controller.snapshot().sessionId,
				text: path.path,
				references,
			});
			await vi.advanceTimersByTimeAsync(500);
			await pending;
		}
		expect(
			controller
				.snapshot()
				.messages.filter((message) => message.role === "user")
				.map(({ text, references: saved }) => ({
					text,
					references: saved,
				})),
		).toEqual([
			{ text: path.path, references },
			{ text: path.path, references },
		]);
	});
}
