// 実在確認・種類判定と、Webview 境界の不正入力拒否を確認する。
import { beforeEach, expect, it, vi } from "vitest";
import { win32 } from "node:path";
const api = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock("vscode", () => ({
	env: {},
	FileType: { File: 1, Directory: 2 },
	Uri: {
		file: (path: string) => ({
			fsPath: path,
			toString: () => `file:///${path.replaceAll("\\", "/")}`,
		}),
	},
	workspace: { fs: { stat: api.stat } },
}));
import { resolvePath } from "../../src/extension/webview/resolvePath";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
beforeEach(() => vi.clearAllMocks());
it("ファイルの範囲を保持し、フォルダや不正な範囲は拒否する", async () => {
	const range = {
		start: { line: 0, character: 2 },
		end: { line: 100, character: 5 },
	};
	const request = {
		type: "workspace/resolvePath" as const,
		requestId: "range",
		path: "D:/test.ts",
		range,
	};
	api.stat.mockResolvedValue({ type: 1 });
	expect(isUiMessage(request)).toBe(true);
	const result = await resolvePath(request);
	expect(result.entry?.range).toEqual(range);
	expect(isHostMessage(result)).toBe(true);
	api.stat.mockResolvedValue({ type: 2 });
	expect((await resolvePath(request)).entry).toBeNull();
	expect(
		isUiMessage({
			...request,
			range: { ...range, start: { line: -1, character: 0 } },
		}),
	).toBe(false);
});
it.each([
	[1, "file"],
	[2, "directory"],
	[66, "directory"],
] as const)("種類%sを%sに変換する", async (type, kind) => {
	api.stat.mockResolvedValue({ type });
	const request = {
		type: "workspace/resolvePath" as const,
		requestId: "paste",
		path: "D:/outside/日本語 sample",
	};
	expect(isUiMessage(request)).toBe(true);
	const result = await resolvePath(request);
	expect(result.entry).toMatchObject({
		name: "日本語 sample",
		path: win32.normalize(request.path),
		kind,
	});
	expect(isHostMessage(result)).toBe(true);
});
it("未存在はnullを返し、診断情報を送らない", async () => {
	api.stat.mockRejectedValue(new Error("private"));
	expect(
		(
			await resolvePath({
				type: "workspace/resolvePath",
				requestId: "x",
				path: "D:\\missing",
			})
		).entry,
	).toBeNull();
});
it("相対パス・改行・不正な応答を拒否する", () => {
	for (const path of [
		"relative.txt",
		"D:relative",
		"\\relative",
		"D:\\a\ntext",
		"",
		42,
	]) {
		expect(
			isUiMessage({
				type: "workspace/resolvePath",
				requestId: "x",
				path,
			}),
		).toBe(false);
	}
	expect(
		isUiMessage({
			type: "workspace/resolvePath",
			requestId: "x",
			path: "\\\\server\\share\\file",
		}),
	).toBe(true);
	expect(
		isHostMessage({
			type: "workspace/resolvedPath",
			requestId: "x",
			entry: {},
		}),
	).toBe(false);
});
