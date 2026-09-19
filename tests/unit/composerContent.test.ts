// 下書きの共有時に不正な断片や本文との不一致を拒否する。
import { describe, it, expect } from "vitest";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import type { ComposerPart } from "../../src/shared/composerContent";
import { validReferences } from "../../src/shared/composerReferences";

it("チップの参照位置・種別・本文との対応を検証する", () => {
	const path = {
		uri: "file:///D:/src",
		name: "src",
		path: "D:\\src",
		kind: "directory",
	};
	const references = [{ offset: 1, path }];
	expect(validReferences("前D:\\src 後", references)).toBe(true);
	for (const invalid of [
		null,
		[{ offset: -1, path }],
		[{ offset: 0, path }],
		[...references, ...references],
		[{ offset: 1.5, path }],
		[{ offset: 1, path: { ...path, kind: "unknown" } }],
	]) {
		expect(validReferences("前D:\\src 後", invalid)).toBe(false);
	}
	expect(
		isUiMessage({
			type: "ui/saveDraft",
			requestId: "reference",
			draft: "前D:\\src 後",
			draftParts: [
				{ id: "text", type: "text", text: "前D:\\src 後", references },
			],
		}),
	).toBe(true);
});

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
