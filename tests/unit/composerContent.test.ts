// 下書きの共有時に不正な断片や本文との不一致を拒否する。
import { describe, it, expect } from "vitest";
import { isHostMessage, isUiMessage } from "../../src/shared/validation";
import type { ComposerPart } from "../../src/shared/composerContent";

describe("貼り付けブロックの下書き通信", () => {
	const draftParts: ComposerPart[] = [
		{ id: "before", type: "text", text: "前\n" },
		{ id: "block", type: "pasted", text: "コード\r\n" },
		{ id: "after", type: "text", text: "後" },
	];
	const message = {
		type: "ui/saveDraft",
		requestId: "save",
		draft: "前\nコード\r\n後",
		draftParts,
	};
	it("送信と復元で本文と配置を保持する", () => {
		expect(isUiMessage(message)).toBe(true);
		expect(
			isHostMessage({
				...message,
				type: "ui/viewState",
				editor: true,
				restoreScroll: true,
				scrollTop: 0,
			}),
		).toBe(true);
		expect(isUiMessage({ ...message, draftParts: undefined })).toBe(true);
	});
	it("欠けた本文・重複ID・不正な順序・過大な本文を拒否する", () => {
		for (const invalid of [
			[],
			[null],
			draftParts.slice(0, 2),
			[...draftParts].reverse(),
			draftParts.map((part) => ({ ...part, id: "duplicate" })),
		]) {
			expect(isUiMessage({ ...message, draftParts: invalid })).toBe(
				false,
			);
		}
		expect(isUiMessage({ ...message, draft: "別の本文" })).toBe(false);
		expect(
			isUiMessage({
				...message,
				draft: "a".repeat(100_001),
				draftParts: undefined,
			}),
		).toBe(false);
	});
});
