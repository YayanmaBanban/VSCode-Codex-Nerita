// 送信本文の位置補正・境界検証と、両backendの参照情報の保持を確認する。
import { afterEach, expect, it, vi } from "vitest";
import {
	promptContent,
	promptReferences,
	type ComposerPart,
} from "../../src/shared/composerContent";
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

it.each([
	["てすと", "code", "後文", "てすと\ncode\n後文"],
	["てすと\n", "code\n", "後文", "てすと\ncode\n後文"],
	["てすと\n\n", "code", "", "てすと\n\ncode"],
	["", "code", "", "code"],
])("コードブロックの境界に改行を補う: %j", (before, code, after, expected) => {
	const parts: ComposerPart[] = [
		{ id: "before", type: "text", text: before },
		{ id: "code", type: "pasted", text: code },
		{ id: "after", type: "text", text: after },
	];
	expect(
		promptContent(parts.map((part) => part.text).join(""), parts),
	).toEqual({ text: expected, references: [] });
});

it("連続するブロックを区切り、後続のファイル参照位置を補正する", () => {
	const parts: ComposerPart[] = [
		{ id: "a", type: "text", text: "  てすと" },
		{ id: "b", type: "pasted", text: "code" },
		{ id: "c", type: "text", text: "" },
		{ id: "d", type: "pasted", text: "code2" },
		{ id: "e", type: "text", text: path.path, references },
	];
	const result = promptContent(
		parts.map((part) => part.text).join(""),
		parts,
	);
	expect(result.text).toBe("てすと\ncode\ncode2\nD:/a.ts");
	expect(result.references).toEqual([
		{ offset: result.text.indexOf(path.path), path },
	]);
	expect(
		isUiMessage({
			type: "prompt/send",
			requestId: "test",
			sessionId: "test",
			...result,
		}),
	).toBe(true);
});
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
