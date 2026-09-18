/// <reference lib="dom" />
// 外部由来のクリップボード付加情報を厳密に検証する。
import { expect, it } from "vitest";
import { readClipboardReferences } from "../../src/webview/chat/composer/referenceClipboard";

it("コピー本文と一致する参照だけを受け入れる", () => {
	const path = {
		uri: "file:///D:/src",
		path: "D:\\src",
		name: "src",
		kind: "directory",
	};
	const payload = {
		version: 1,
		text: "前D:\\src後",
		references: [{ offset: 1, path }],
	};
	const read = (value: unknown, text = payload.text) =>
		readClipboardReferences({ getData: () => JSON.stringify(value) }, text);
	expect(read(payload)).toEqual(payload.references);
	for (const value of [
		null,
		{},
		{ ...payload, version: 2 },
		{ ...payload, references: [{}] },
		{ ...payload, references: [{ offset: 0, path }] },
		{
			...payload,
			references: [...payload.references, ...payload.references],
		},
	]) {
		expect(read(value)).toBeNull();
	}
	expect(read(payload, "別の本文")).toBeNull();
	expect(
		readClipboardReferences({ getData: () => "{" }, payload.text),
	).toBeNull();
	expect(
		readClipboardReferences(
			{ getData: () => "x".repeat(4_000_001) },
			payload.text,
		),
	).toBeNull();
});
