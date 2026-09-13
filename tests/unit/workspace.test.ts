// ワークスペース不備の原因とUIに届く案内が一致することを検証する。
import { describe, expect, it } from "vitest";
import { requireLocalWorkspace } from "../../src/extension/workspace";
import { SessionController } from "../../src/extension/session/sessionController";

const folder = { uri: { scheme: "file", fsPath: "D:\\workspace with spaces" } };
describe("ワークスペースの起動条件", () => {
	it("空白を含むローカルパスをそのまま渡す", () => {
		expect(requireLocalWorkspace([folder], true, undefined)).toBe(
			folder.uri.fsPath,
		);
	});
	it("未選択・制限モード・リモート・複数フォルダー・仮想環境を区別する", () => {
		expect(() => requireLocalWorkspace(undefined, true, undefined)).toThrow(
			"作業フォルダーが開かれていません",
		);
		expect(() => requireLocalWorkspace([], false, undefined)).toThrow(
			"作業フォルダーが開かれていません",
		);
		expect(() => requireLocalWorkspace([folder], false, undefined)).toThrow(
			"制限モード",
		);
		expect(() => requireLocalWorkspace([folder], true, "wsl")).toThrow(
			"Remote",
		);
		expect(() =>
			requireLocalWorkspace([folder, folder], true, undefined),
		).toThrow("一つの作業フォルダー");
		expect(() =>
			requireLocalWorkspace(
				[{ uri: { scheme: "vscode-vfs", fsPath: "virtual" } }],
				true,
				undefined,
			),
		).toThrow("仮想ワークスペース");
	});
	it("フォルダー未選択の具体的な案内をHostからUIに伝える", async () => {
		const controller = new SessionController(() => {
			requireLocalWorkspace(undefined, true, undefined);
			throw new Error("unreachable");
		});
		await controller.receive({
			type: "connection/retry",
			requestId: "connect",
		});
		expect(controller.snapshot().connection).toBe("error");
		expect(controller.snapshot().error).toContain(
			"ファイル → フォルダーを開く",
		);
		await controller.dispose();
	});
	it("通常の例外の内部情報はUIに表示しない", async () => {
		const controller = new SessionController(() => {
			throw new Error("secret diagnostic");
		});
		await controller.connect();
		expect(controller.snapshot().error).not.toContain("secret diagnostic");
		await controller.dispose();
	});
});
