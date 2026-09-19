// ファイル・フォルダの表示先と、実行可能URIを拒否するHost境界を確認する。
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ stat: vi.fn(), executeCommand: vi.fn() }));
vi.mock("vscode", () => ({
	Range: class {
		start: { line: number; character: number };
		end: { line: number; character: number };
		/** VS Codeの座標を保持するテスト用範囲。 */
		constructor(sl: number, sc: number, el: number, ec: number) {
			this.start = { line: sl, character: sc };
			this.end = { line: el, character: ec };
		}
	},
	Uri: {
		parse: (value: string) => {
			const uri = new URL(value);
			return {
				scheme: uri.protocol.slice(0, -1),
				query: uri.search,
				fragment: uri.hash,
				toString: () => uri.href,
			};
		},
	},
	FileType: { File: 1, Directory: 2 },
	ViewColumn: { Active: -1 },
	workspace: { fs: { stat: api.stat } },
	commands: { executeCommand: api.executeCommand },
}));
import { openResource } from "../../src/extension/webview/openResource";
import { attachmentService } from "../../src/extension/webview/attachments";
import { isUiMessage } from "../../src/shared/uiMessageValidation";

beforeEach(() => {
	vi.clearAllMocks();
	api.stat.mockResolvedValue({ type: 1 });
	api.executeCommand.mockResolvedValue(undefined);
});
it("ファイルはアクティブなエディタグループの固定タブで開く", async () => {
	await openResource("file:///D:/project/main.ts");
	expect(api.executeCommand).toHaveBeenCalledWith(
		"vscode.open",
		expect.anything(),
		{ viewColumn: -1, preview: false, preserveFocus: false },
	);
	expect(api.stat).toHaveBeenCalledTimes(1);
});
it("フォルダは実際の種別を調べてExplorerへ表示する", async () => {
	api.stat.mockResolvedValue({ type: 66 });
	await openResource("file:///D:/project/src");
	expect(api.executeCommand).toHaveBeenCalledWith(
		"revealInExplorer",
		expect.anything(),
	);
});
it("シンボルのチップはファイルの定義範囲を選択して開く", async () => {
	const range = {
		start: { line: 41, character: 2 },
		end: { line: 137, character: 1 },
	};
	await openResource("file:///D:/project/service.ts", range);
	expect(api.executeCommand).toHaveBeenCalledWith(
		"vscode.open",
		expect.anything(),
		{
			viewColumn: -1,
			preview: false,
			preserveFocus: false,
			selection: range,
		},
	);
});
it("添付画像・PDFにもVS Codeの標準オープナーを使う", async () => {
	for (const name of ["design.png", "report.pdf"]) {
		await attachmentService.open({
			id: name,
			name,
			uri: `file:///D:/attachments/${name}`,
		});
	}
	expect(api.executeCommand).toHaveBeenCalledTimes(2);
	expect(
		api.executeCommand.mock.calls.every(
			([command]) => command === "vscode.open",
		),
	).toBe(true);
});
it("コマンドURI・Web URL・URI付加情報を拒否し実行しない", async () => {
	for (const uri of [
		"command:workbench.action.closeWindow",
		"https://example.com/file",
		"file:///D:/file?x=1",
		"file:///D:/file#command",
		"not a uri",
	]) {
		await expect(openResource(uri)).rejects.toThrow();
	}
	expect(api.stat).not.toHaveBeenCalled();
	expect(api.executeCommand).not.toHaveBeenCalled();
});
it("削除された参照・未対応種別・オープナー失敗を呼び出し元へ返す", async () => {
	api.stat.mockRejectedValueOnce(new Error("missing"));
	await expect(openResource("file:///D:/missing")).rejects.toThrow();
	api.stat.mockResolvedValueOnce({ type: 0 });
	await expect(openResource("file:///D:/unknown")).rejects.toThrow();
	expect(api.executeCommand).not.toHaveBeenCalled();
	api.executeCommand.mockRejectedValueOnce(new Error("cannot open"));
	await expect(openResource("file:///D:/file")).rejects.toThrow();
});
it("開く要求の必須フィールドと長さを検証する", () => {
	expect(
		isUiMessage({
			type: "reference/open",
			requestId: "x",
			uri: "file:///D:/file",
		}),
	).toBe(true);
	for (const uri of [null, "", 1, "a".repeat(32_769)]) {
		expect(
			isUiMessage({ type: "reference/open", requestId: "x", uri }),
		).toBe(false);
	}
});
