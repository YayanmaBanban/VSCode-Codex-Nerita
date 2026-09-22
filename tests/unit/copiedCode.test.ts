// コピー通知の記録・本文照合と、送信時の最新範囲読み取りを検証する。
import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
const api = vi.hoisted(() => ({
	register: vi.fn(),
	open: vi.fn(),
	dispose: vi.fn(),
}));
vi.mock("vscode", () => ({
	env: {},
	languages: { registerDocumentPasteEditProvider: api.register },
	workspace: { openTextDocument: api.open },
	Uri: {
		parse: (value: string) => {
			const url = new URL(value);
			return {
				scheme: url.protocol.slice(0, -1),
				query: url.search,
				fragment: url.hash,
			};
		},
	},
	DataTransferItem: class {
		constructor(public value: unknown) {}
	},
	Range: class {
		start: { line: number; character: number };
		end: { line: number; character: number };
		constructor(sl: number, sc: number, el: number, ec: number) {
			this.start = { line: sl, character: sc };
			this.end = { line: el, character: ec };
		}
		get isEmpty() {
			return JSON.stringify(this.start) === JSON.stringify(this.end);
		}
		isEqual(other: unknown) {
			return JSON.stringify(this) === JSON.stringify(other);
		}
	},
}));
import { Range } from "vscode";
import { CopiedCode } from "../../src/extension/webview/copiedCode";
import { readCodeReferenceContext } from "../../src/extension/session/codeReferenceContext";
import { isUiMessage } from "../../src/shared/uiMessageValidation";

const reference = {
	uri: "file:///D:/test.ts",
	range: { start: { line: 1, character: 0 }, end: { line: 2, character: 3 } },
};
let text = "const a = 1;\r\nend";
const document = {
	uri: {
		scheme: "file",
		fsPath: "D:\\test.ts",
		toString: () => reference.uri,
	},
	getText: vi.fn(() => text),
	validateRange: vi.fn((range: vscode.Range) => range),
	lineAt: vi.fn(() => ({ range: new Range(1, 0, 1, 10) })),
};

beforeEach(() => {
	vi.clearAllMocks();
	text = "const a = 1;\r\nend";
	api.register.mockReturnValue({ dispose: api.dispose });
	api.open.mockResolvedValue(document);
	document.validateRange.mockImplementation((range) => range);
});

/** 登録された本物のプロバイダーへ、エディタのコピー通知を渡す。 */
function copy(ranges = [new Range(1, 0, 2, 3)]) {
	const token: vscode.CancellationToken = {
		isCancellationRequested: false,
		onCancellationRequested: vi.fn(),
	};
	const provider = api.register.mock.calls.at(
		-1,
	)![1] as vscode.DocumentPasteEditProvider;
	provider.prepareDocumentPaste!(
		document as unknown as vscode.TextDocument,
		ranges,
		{ set: vi.fn() } as unknown as vscode.DataTransfer,
		token,
	);
}

it("コピー元の座標を保持し、改行差を許容して照合する", async () => {
	const service = new CopiedCode();
	copy();
	expect(await service.resolve(text.replaceAll("\r\n", "\n"))).toMatchObject({
		...reference,
		kind: "file",
		name: "test.ts",
	});
	expect(await service.resolve("別のコード")).toBeNull();
	service.dispose();
	expect(api.dispose).toHaveBeenCalled();
	expect(await service.resolve(text)).toBeNull();
});

it("複数選択や選択なしのコピーで古い参照を無効にする", async () => {
	const service = new CopiedCode();
	copy();
	copy([new Range(0, 0, 0, 1), new Range(1, 0, 1, 1)]);
	expect(await service.resolve(text)).toBeNull();
	copy();
	copy([new Range(1, 0, 1, 0)]);
	expect(await service.resolve(text)).toBeNull();
});

it("コピー後の編集や範囲縮小を誤って参照化しない", async () => {
	const service = new CopiedCode();
	copy();
	const copied = text;
	text = "updated";
	expect(await service.resolve(copied)).toBeNull();
	text = copied;
	document.validateRange.mockReturnValue(new Range(0, 0, 0, 0));
	expect(await service.resolve(copied)).toBeNull();
});

it("送信のたびに最新本文を読み、同じ参照は一度だけ読む", async () => {
	expect(await readCodeReferenceContext([reference, reference])).toContain(
		"const a = 1;",
	);
	expect(api.open).toHaveBeenCalledTimes(1);
	text = "updated unsaved code";
	expect(await readCodeReferenceContext([reference])).toContain(text);
	expect(document.getText).toHaveBeenLastCalledWith(new Range(1, 0, 2, 3));
});

it("不正URI・範囲外・読み込み失敗・サイズ超過を送信前に拒否する", async () => {
	await expect(
		readCodeReferenceContext([{ ...reference, uri: "command:run" }]),
	).rejects.toThrow("参照したコード");
	document.validateRange.mockReturnValueOnce(new Range(0, 0, 0, 0));
	await expect(readCodeReferenceContext([reference])).rejects.toThrow(
		"参照したコード",
	);
	api.open.mockRejectedValueOnce(new Error("missing"));
	await expect(readCodeReferenceContext([reference])).rejects.toThrow(
		"参照したコード",
	);
	text = "x".repeat(100_001);
	await expect(readCodeReferenceContext([reference])).rejects.toThrow(
		"参照したコード",
	);
});

it("読み込み後の送信先変更を検出する", async () => {
	const check = vi
		.fn()
		.mockImplementationOnce(() => {})
		.mockImplementation(() => {
			throw new Error("stale");
		});
	await expect(readCodeReferenceContext([reference], check)).rejects.toThrow(
		"stale",
	);
});

it("境界で本文と参照の上限を検証する", () => {
	const request = {
		type: "prompt/send",
		requestId: "x",
		sessionId: "s",
		text: "review",
		codeReferences: [reference],
	};
	expect(isUiMessage(request)).toBe(true);
	expect(
		isUiMessage({ ...request, codeReferences: Array(21).fill(reference) }),
	).toBe(false);
	expect(
		isUiMessage({
			...request,
			codeReferences: [{ uri: reference.uri, range: {} }],
		}),
	).toBe(false);
	expect(
		isUiMessage({ type: "workspace/resolveCode", requestId: "x", text }),
	).toBe(true);
	expect(
		isUiMessage({
			type: "workspace/resolveCode",
			requestId: "x",
			text: " ",
		}),
	).toBe(false);
});
