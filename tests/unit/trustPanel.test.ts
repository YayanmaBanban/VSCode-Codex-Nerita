// Webview の要求を Host で受け、確認後だけ保存済みの記録を削除する。
import { afterEach, expect, it, vi } from "vitest";
import { stat } from "node:fs/promises";
import type { ExtensionContext } from "vscode";
import { trustPanel } from "../../src/extension/security/trust/TrustPanel";
import { sandboxFixture } from "./sandboxFixtures";
import type { TrustReply } from "@nerita/shared/workspaceTrust";

const api = vi.hoisted(() => ({
	createWebviewPanel: vi.fn(),
	showWarningMessage: vi.fn(),
}));
vi.mock("vscode", () => ({
	window: api,
	ViewColumn: { Active: -1 },
	Uri: { joinPath: () => ({}) },
}));
vi.mock("../../src/extension/webview/webviewHtml", () => ({
	webviewHtml: () => "<html></html>",
}));
const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	vi.resetAllMocks();
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** VS Code の画面境界だけを置き換え、削除には製品の保存処理を使う。 */
async function fixture() {
	const h = await sandboxFixture();
	fixtures.push(h);
	let receive: (message: unknown) => void = () => {};
	let close = () => {};
	const postMessage = vi.fn<(message: TrustReply) => void>();
	const panel = {
		reveal: vi.fn(),
		webview: {
			postMessage,
			onDidReceiveMessage: (listener: typeof receive) => {
				receive = listener;
				return { dispose() {} };
			},
		},
		onDidDispose: (listener: () => void) => {
			close = listener;
		},
	};
	api.createWebviewPanel.mockReturnValue(panel);
	const context = {
		subscriptions: [],
		extensionUri: {},
	} as unknown as ExtensionContext;
	const confirm = vi.fn();
	const open = trustPanel(context, h.trustStore, confirm);
	open();
	return {
		...h,
		open,
		panel,
		confirm,
		postMessage,
		receive: (message: unknown) => receive(message),
		close: () => close(),
	};
}

it("管理画面を再利用し、削除の取消しでは記録を保持する", async () => {
	const h = await fixture();
	h.open();
	expect(api.createWebviewPanel).toHaveBeenCalledOnce();
	expect(h.panel.reveal).toHaveBeenCalledOnce();
	api.showWarningMessage.mockResolvedValue(undefined);
	h.receive({ type: "remove", root: h.cwd });
	await vi.waitFor(() => expect(h.postMessage).toHaveBeenCalled());
	expect(await h.trustStore.trusted(h.cwd)).toBe(true);
});

it("確認後は記録だけを削除し、実フォルダーは保持する", async () => {
	const h = await fixture();
	api.showWarningMessage.mockResolvedValue("記録を削除");
	h.receive({ type: "remove", root: h.cwd });
	await vi.waitFor(() => expect(h.trustStore.list()).toEqual([]));
	expect((await stat(h.cwd)).isDirectory()).toBe(true);
	expect(await h.trustStore.trusted(h.cwd)).toBe(false);
});

it("閉じた画面と未登録のパスからは信頼を変更しない", async () => {
	const h = await fixture();
	h.receive({ type: "trust", root: "unknown" });
	await vi.waitFor(() =>
		expect(h.postMessage.mock.lastCall?.[0].error).toContain(
			"記録がありません",
		),
	);
	h.close();
	h.receive({ type: "trust", root: h.cwd });
	await Promise.resolve();
	expect(h.confirm).not.toHaveBeenCalled();
});
