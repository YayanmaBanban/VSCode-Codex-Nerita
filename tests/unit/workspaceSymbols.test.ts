// プロバイダー結果の正規化、通信境界、参照の保存形式を検証する。
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	getWorkspaceFolder: vi.fn(),
}));
vi.mock("vscode", () => ({
	commands: { executeCommand: api.executeCommand },
	workspace: { getWorkspaceFolder: api.getWorkspaceFolder },
}));
import { searchWorkspaceSymbols } from "../../src/extension/webview/workspaceSymbols";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { pathText, validReferences } from "../../src/shared/composerReferences";
import { isSourceRange } from "../../src/shared/symbolLocation";
const request = {
	type: "workspace/searchSymbols" as const,
	requestId: "symbols",
	query: "User",
};
/** VS Code が返すシンボルを最小限の API で再現する。 */
function symbol(name = "User", line = 4, scheme = "file") {
	return {
		name,
		kind: 4,
		location: {
			uri: {
				scheme,
				query: "",
				fragment: "",
				fsPath: "D:\\project\\user.ts",
				toString: () => `${scheme}:///D:/project/user.ts`,
			},
			range: {
				start: { line, character: 2 },
				end: { line: line + 3, character: 5 },
			},
		},
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	api.getWorkspaceFolder.mockReturnValue({ name: "project" });
});
it("空検索ではプロバイダーを呼ばず、通常検索では位置と種類を保持する", async () => {
	expect(
		(await searchWorkspaceSymbols({ ...request, query: "  " })).entries,
	).toEqual([]);
	expect(api.executeCommand).not.toHaveBeenCalled();
	api.executeCommand.mockResolvedValue([
		symbol(),
		symbol(),
		symbol("User", 20),
	]);
	const result = await searchWorkspaceSymbols(request);
	expect(api.executeCommand).toHaveBeenCalledWith(
		"vscode.executeWorkspaceSymbolProvider",
		"User",
	);
	expect(result.entries).toHaveLength(2);
	expect(isHostMessage(result)).toBe(true);
	const reference = result.entries[0]!;
	expect(pathText(reference)).toBe("D:\\project\\user.ts:5:3 (User)");
	expect(
		validReferences(pathText(reference), [{ offset: 0, path: reference }]),
	).toBe(true);
	expect(reference.symbol?.range).toEqual(symbol().location.range);
});
it("空応答・失敗・不正な場所を処理し、内部エラーを露出しない", async () => {
	api.executeCommand.mockResolvedValue(undefined);
	expect((await searchWorkspaceSymbols(request)).entries).toEqual([]);
	api.executeCommand.mockResolvedValue([
		symbol("bad", -1),
		symbol("web", 0, "https"),
	]);
	expect((await searchWorkspaceSymbols(request)).entries).toEqual([]);
	api.getWorkspaceFolder.mockReturnValue(undefined);
	api.executeCommand.mockResolvedValue([symbol()]);
	expect((await searchWorkspaceSymbols(request)).entries).toEqual([]);
	api.executeCommand.mockRejectedValue(new Error("private detail"));
	const result = await searchWorkspaceSymbols(request);
	expect(result.error).toContain("検索できません");
	expect(result.error).not.toContain("private detail");
});
it("重複を除いて100件に制限し、絞り込みの必要性を通知する", async () => {
	api.executeCommand.mockResolvedValue(
		Array.from({ length: 102 }, (_, index) => symbol(`User${index}`)),
	);
	const result = await searchWorkspaceSymbols(request);
	expect(result.entries).toHaveLength(100);
	expect(result.truncated).toBe(true);
	expect(isHostMessage(result)).toBe(true);
});
it("検索語と位置情報を通信・下書き復元の双方で検証する", async () => {
	expect(isUiMessage(request)).toBe(true);
	for (const query of [null, 12, "x".repeat(257)]) {
		expect(isUiMessage({ ...request, query })).toBe(false);
	}
	for (const range of [
		null,
		{},
		{ start: { line: -1, character: 0 }, end: { line: 0, character: 0 } },
		{ start: { line: 2, character: 0 }, end: { line: 1, character: 0 } },
	]) {
		expect(isSourceRange(range)).toBe(false);
		expect(
			isUiMessage({
				type: "reference/open",
				requestId: "open",
				uri: "file:///D:/file",
				range,
			}),
		).toBe(false);
	}
	api.executeCommand.mockResolvedValue([symbol()]);
	const result = await searchWorkspaceSymbols(request);
	const entry = result.entries[0]!;
	const broken = { ...entry, symbol: { ...entry.symbol, kind: 26 } };
	expect(isHostMessage({ ...result, entries: [broken] })).toBe(false);
	expect(
		validReferences(pathText(entry), [{ offset: 0, path: broken }]),
	).toBe(false);
});
