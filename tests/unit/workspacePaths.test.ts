// 遅延列挙・ワークスペース境界・通信検証を VS Code の代替 API で確認する。
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
	readDirectory: vi.fn(),
	getWorkspaceFolder: vi.fn(),
}));
vi.mock("vscode", () => {
	/** テスト用 URI を生成し、空白や日本語の復号も再現する。 */
	const parse = (value: string) => {
		const url = new URL(value);
		return {
			scheme: url.protocol.slice(0, -1),
			query: url.search,
			fragment: url.hash,
			fsPath: decodeURIComponent(url.pathname.slice(1)).replaceAll(
				"/",
				"\\",
			),
			toString: () => url.href,
		};
	};
	return {
		FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
		Uri: {
			parse,
			joinPath: (uri: { toString(): string }, name: string) =>
				parse(`${uri.toString()}/${encodeURIComponent(name)}`),
		},
		workspace: {
			workspaceFolders: [
				{ name: "project", uri: parse("file:///D:/project") },
			],
			fs: { readDirectory: api.readDirectory },
			getWorkspaceFolder: api.getWorkspaceFolder,
		},
	};
});
import { listWorkspacePaths } from "../../src/extension/webview/workspacePaths";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";

beforeEach(() => {
	vi.clearAllMocks();
	api.getWorkspaceFolder.mockReturnValue({ name: "project" });
});
it("入口ではルートだけを返し、配下を読まない", async () => {
	const result = await listWorkspacePaths({
		type: "workspace/listPaths",
		requestId: "roots",
		uri: null,
	});
	expect(result.entries).toEqual([
		{
			uri: "file:///D:/project",
			name: "project",
			path: "D:\\project",
			kind: "directory",
		},
	]);
	expect(api.readDirectory).not.toHaveBeenCalled();
	expect(isHostMessage(result)).toBe(true);
});
it("選択された一階層だけを列挙し、除外項目と型のビットを処理する", async () => {
	api.readDirectory.mockResolvedValue([
		["日本語 sample.md", 1],
		["src", 2],
		["linked", 66],
		[".git", 2],
		["node_modules", 2],
		["unknown", 0],
	]);
	const result = await listWorkspacePaths({
		type: "workspace/listPaths",
		requestId: "children",
		uri: "file:///D:/project",
	});
	expect(api.readDirectory).toHaveBeenCalledTimes(1);
	expect(result.entries.map((item) => [item.name, item.kind])).toEqual([
		["linked", "directory"],
		["src", "directory"],
		["日本語 sample.md", "file"],
	]);
	expect(result.entries[2]?.path).toBe("D:\\project\\日本語 sample.md");
	expect(isHostMessage(result)).toBe(true);
});
it("ワークスペース外と読み込み失敗を個別要求のエラーとして返す", async () => {
	api.getWorkspaceFolder.mockReturnValue(undefined);
	const request = {
		type: "workspace/listPaths" as const,
		requestId: "outside",
		uri: "file:///D:/outside",
	};
	expect((await listWorkspacePaths(request)).error).toBeTruthy();
	expect(api.readDirectory).not.toHaveBeenCalled();
	api.getWorkspaceFolder.mockReturnValue({ name: "project" });
	api.readDirectory.mockRejectedValue(new Error("private diagnostic"));
	const result = await listWorkspacePaths({
		...request,
		uri: "file:///D:/project",
	});
	expect(result.entries).toEqual([]);
	expect(result.error).not.toContain("private diagnostic");
	expect(isHostMessage(result)).toBe(true);
});
it("不正な要求と壊れた一覧項目を通信の両端で拒否する", () => {
	for (const uri of [undefined, 42, "", "x".repeat(32_769)]) {
		expect(
			isUiMessage({ type: "workspace/listPaths", requestId: "x", uri }),
		).toBe(false);
	}
	expect(
		isUiMessage({ type: "workspace/listPaths", requestId: "x", uri: null }),
	).toBe(true);
	for (const entries of [
		null,
		[{}],
		[
			{
				uri: "file:///D:/project",
				name: "project",
				path: "D:\\project",
				kind: "other",
			},
		],
	]) {
		expect(
			isHostMessage({ type: "workspace/paths", requestId: "x", entries }),
		).toBe(false);
	}
});
