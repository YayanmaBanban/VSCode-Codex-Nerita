// ドロップ通信の検証と、Hostでの保存・重複排除・非対応入力の拒否を確認する。
import { afterEach, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import {
	droppedAttachments,
	disposeDroppedAttachments,
} from "../../src/extension/webview/droppedAttachments";

afterEach(disposeDroppedAttachments);

it("ピッカー要求とドロップ要求を受け付け、不正なパスや内容を拒否する", () => {
	const message = {
		type: "attachment/add",
		requestId: "request",
		sessionId: "session",
	};
	expect(isUiMessage(message)).toBe(true);
	expect(
		isUiMessage({ ...message, files: [{ uri: "file:///D:/日本語.txt" }] }),
	).toBe(true);
	for (const files of [
		[],
		[{ uri: "https://example.com/a" }],
		[{ name: "../a", data: "" }],
		[{ name: "NUL.txt", data: "" }],
		[{ name: "a.txt", data: "invalid" }],
		Array.from({ length: 21 }, () => ({ uri: "file:///D:/a.txt" })),
	]) {
		expect(isUiMessage({ ...message, files })).toBe(false);
	}
});

it("日本語ファイルを保存し、同じ名前・内容は同じURIへ正規化する", async () => {
	const files = [
		{
			name: "日本語.txt",
			data: Buffer.from("添付内容").toString("base64"),
		},
	];
	const first = await droppedAttachments(files);
	const second = await droppedAttachments(files);
	expect(first[0]!.uri).toBe(second[0]!.uri);
	expect(first[0]!.name).toBe("日本語.txt");
	expect(await readFile(fileURLToPath(first[0]!.uri), "utf8")).toBe(
		"添付内容",
	);
	expect((await droppedAttachments([{ uri: first[0]!.uri }]))[0]!.uri).toBe(
		first[0]!.uri,
	);
});

it("非対応バイナリーと2MB超のテキストを追加前に拒否する", async () => {
	await expect(
		droppedAttachments([
			{
				name: "binary.bin",
				data: Buffer.from([0, 1, 2]).toString("base64"),
			},
		]),
	).rejects.toThrow("Binary attachment");
	await expect(
		droppedAttachments([
			{
				name: "large.txt",
				data: Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString("base64"),
			},
		]),
	).rejects.toThrow("Attachment too large");
});

it("拡張機能終了時に転送ファイルを削除する", async () => {
	const files = await droppedAttachments([{ name: "empty.txt", data: "" }]);
	await disposeDroppedAttachments();
	await expect(readFile(fileURLToPath(files[0]!.uri))).rejects.toThrow();
});
